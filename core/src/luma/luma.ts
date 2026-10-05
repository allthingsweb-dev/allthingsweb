import {
  Clock,
  Config,
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Schedule,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import {
  allThingsWebCalendarId,
  type FeedEvent,
  LumaFeedError,
  parseCalendar,
} from "./feed.ts";

/**
 * Luma, as the sync reads it: the calendar's public iCalendar feed, the source
 * the app's hourly sync reads (app/src/lib/luma/public-calendar.ts). The feed
 * needs no API key; it is the whole calendar in one document, so there are no
 * pages to follow.
 *
 * The app tries once. Here a failure Luma may recover from (no answer in
 * time, a dropped connection, 429 or a 5xx) is tried again, after the
 * Retry-After Luma sends or with exponential backoff, before the sync fails.
 */

/** A Luma calendar's API id, as LUMA_CALENDAR_API_ID holds it. */
export const CalendarId = Schema.String.check(
  Schema.isPattern(/^cal-[A-Za-z0-9]+$/),
);

/** The calendar to read: LUMA_CALENDAR_API_ID, or All Things Web's. */
export const calendarIdConfig: Config.Config<string> = Config.schema(
  CalendarId,
  "LUMA_CALENDAR_API_ID",
).pipe(Config.withDefault(allThingsWebCalendarId));

/** Each attempt gets this long to answer in full. */
export const attemptTimeout = Duration.seconds(20);
/** Attempts after the first. */
export const maxRetries = 3;
/** The first retry's delay, doubled for each one after it. */
export const backoffBase = Duration.seconds(1);
/**
 * The longest Retry-After waited out. A longer one fails the run instead:
 * the next hourly run tries again.
 */
export const maxRetryAfter = Duration.minutes(1);

/**
 * What a request to Luma asked for, as its errors name it: the calendar's
 * feed (the default), or one event from Luma's API (src/luma/api.ts).
 */
export const LumaResource = Schema.Literals(["calendar", "event"]);
export type LumaResource = typeof LumaResource.Type;

/** Luma did not answer, or answered 429 or 5xx: worth another try. */
export class LumaUnavailable extends Schema.TaggedError<LumaUnavailable>()(
  "LumaUnavailable",
  {
    /** The response's status, or null when there was no response in time. */
    status: Schema.NullOr(Schema.Int),
    /** How long Luma asked us to wait, if it did. */
    retryAfter: Schema.NullOr(Schema.Duration),
    cause: Schema.optional(Schema.Defect()),
    resource: Schema.optional(LumaResource),
  },
) {
  override get message(): string {
    const what = `Luma ${this.resource ?? "calendar"} request failed`;
    return this.status === null
      ? `${what} without a response`
      : `${what}: ${this.status}`;
  }
}

/** Luma refused the request (a 4xx other than 429): trying again won't help. */
export class LumaRejected extends Schema.TaggedError<LumaRejected>()(
  "LumaRejected",
  { status: Schema.Int, resource: Schema.optional(LumaResource) },
) {
  override get message(): string {
    return `Luma ${this.resource ?? "calendar"} request failed: ${this.status}`;
  }
}

export type LumaError = LumaUnavailable | LumaRejected | LumaFeedError;

const httpDate =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * How long a Retry-After header asks us to wait from `now`: delay-seconds or
 * an HTTP-date (RFC 9110, 10.2.3). A date in the past means no wait; a value
 * that is neither is ignored.
 */
export function retryAfter(
  header: string | undefined,
  now: DateTime.Utc,
): Duration.Duration | null {
  const value = header?.trim();
  if (value === undefined) return null;
  if (/^\d+$/.test(value)) return Duration.seconds(Number(value));
  if (!httpDate.test(value)) return null;
  return Option.match(DateTime.make(value), {
    onNone: () => null,
    onSome: (at) =>
      Duration.millis(
        Math.max(0, DateTime.toEpochMillis(at) - DateTime.toEpochMillis(now)),
      ),
  });
}

/** The delay before retry `attempt` (1-based), unless Luma asks otherwise. */
const retrySchedule = Schedule.exponential(backoffBase).pipe(
  Schedule.setInputType<LumaError>(),
  Schedule.modifyDelay(({ input, duration }) =>
    Effect.succeed(
      input._tag === "LumaUnavailable" && input.retryAfter !== null
        ? input.retryAfter
        : duration,
    ),
  ),
);

const isRetryable = (error: LumaError): boolean =>
  error._tag === "LumaUnavailable" &&
  (error.retryAfter === null ||
    Duration.isLessThanOrEqualTo(error.retryAfter, maxRetryAfter));

/**
 * Sends `request` and reads the body of a 2xx answer as text, trying again
 * after a failure Luma may recover from: no answer within
 * {@link attemptTimeout}, a dropped connection, 429 or a 5xx, after the
 * Retry-After Luma sends (up to {@link maxRetryAfter}) or with exponential
 * backoff, at most {@link maxRetries} times. Other statuses fail at once.
 */
export const sendWithRetries = (
  client: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
  resource?: LumaResource,
): Effect.Effect<string, LumaUnavailable | LumaRejected> => {
  const onResource = resource === undefined ? {} : { resource };
  const attempt: Effect.Effect<string, LumaUnavailable | LumaRejected> =
    Effect.gen(function* () {
      const response = yield* client.execute(request);
      if (response.status >= 200 && response.status < 300) {
        return yield* response.text;
      }
      if (response.status === 429 || response.status >= 500) {
        const now = yield* Clock.currentTimeMillis;
        return yield* new LumaUnavailable({
          status: response.status,
          retryAfter: retryAfter(
            response.headers["retry-after"],
            DateTime.makeUnsafe(now),
          ),
          ...onResource,
        });
      }
      return yield* new LumaRejected({
        status: response.status,
        ...onResource,
      });
    }).pipe(
      Effect.timeout(attemptTimeout),
      Effect.catchTags({
        HttpClientError: (cause) =>
          Effect.fail(
            new LumaUnavailable({
              status: null,
              retryAfter: null,
              cause,
              ...onResource,
            }),
          ),
        TimeoutError: (cause) =>
          Effect.fail(
            new LumaUnavailable({
              status: null,
              retryAfter: null,
              cause,
              ...onResource,
            }),
          ),
      }),
    );
  return attempt.pipe(
    Effect.retry({
      schedule: retrySchedule,
      times: maxRetries,
      while: isRetryable,
    }),
  );
};

export interface LumaShape {
  /** Every event on the calendar, past and future, each once. */
  readonly calendarEvents: Effect.Effect<ReadonlyArray<FeedEvent>, LumaError>;
}

const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const calendarId = yield* calendarIdConfig;

  const request = HttpClientRequest.get("https://api.luma.com/ics/get").pipe(
    HttpClientRequest.setUrlParams({ entity: "calendar", id: calendarId }),
    HttpClientRequest.accept("text/calendar"),
  );

  const calendarEvents = sendWithRetries(client, request).pipe(
    Effect.flatMap(parseCalendar),
    Effect.withSpan("Luma.calendarEvents"),
  );

  return Luma.of({ calendarEvents });
});

export class Luma extends Context.Service<Luma, LumaShape>()("allthings/Luma") {
  /** Needs an `HttpClient`: `FetchHttpClient.layer` in a Worker. */
  static readonly layer = Layer.effect(Luma, make);
}
