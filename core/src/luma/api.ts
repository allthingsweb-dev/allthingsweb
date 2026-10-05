import {
  Config,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import { Headers, HttpClient, HttpClientRequest } from "effect/http";
import { LumaRejected, LumaUnavailable, sendWithRetries } from "./luma.ts";

/**
 * Luma's official API (https://docs.luma.com), for what the calendar feed
 * does not carry: who hosted an event and how many guests it had. Its key is
 * a Luma calendar's API key, which needs Luma Plus, read from LUMA_API_KEY;
 * without one there is nothing to ask, and {@link LumaApiShape.eventPeople}
 * is `None`.
 *
 * One request per event: `GET /v1/events/get`. For an event our calendar
 * manages (`access: "manage"`) it lists the hosts and counts guests by
 * status; for a public event another calendar manages (`access: "view"`) it
 * lists the hosts the event page shows and no counts. Hosts come with their
 * Luma user id, name and avatar; their email is in the response too and is
 * never read.
 *
 * Requests are tried again as the calendar feed's are (src/luma/luma.ts).
 * The API allows 200 requests a minute per calendar key; callers stay well
 * under it.
 */

/** Luma's API, as docs.luma.com documents it. */
export const apiOrigin = "https://public-api.luma.com";

/** The header Luma reads the key from; redacted wherever headers are shown. */
export const apiKeyHeader = "x-luma-api-key";

/** LUMA_API_KEY, if it is set. */
export const apiKeyConfig: Config.Config<Option.Option<Redacted.Redacted>> =
  Config.option(Config.Redacted("LUMA_API_KEY"));

/** A Luma user id, such as `usr-WXyCkk4j4U1CIHQ`. */
export const LumaUserId = Schema.String.check(
  Schema.isPattern(/^usr-[A-Za-z0-9]+$/),
);

/** A Luma event id, such as `evt-CIXBbu7ySP61MNP`. */
export const LumaEventId = Schema.String.check(
  Schema.isPattern(/^evt-[A-Za-z0-9]+$/),
);

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const GuestCount = Schema.Struct({ guests: Count });

/** The part of `GET /v1/events/get`'s answer that is read. */
export const ApiEvent = Schema.Struct({
  id: LumaEventId,
  access: Schema.Literals(["manage", "view"]),
  hosts: Schema.Array(
    Schema.Struct({
      id: LumaUserId,
      name: Schema.NullOr(Schema.String),
      avatar_url: Schema.NullOr(Schema.String),
    }),
  ),
  guest_counts: Schema.optionalKey(
    Schema.Struct({ approved: GuestCount, checked_in: GuestCount }),
  ),
});
export type ApiEvent = typeof ApiEvent.Type;

/** A host of an event, as Luma shows them. */
export interface LumaHost {
  readonly lumaUserId: string;
  /** The name they go by on Luma; Luma allows none. */
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

/** An event's hosts, in Luma's order, and its guests. */
export interface LumaEventPeople {
  readonly lumaEventId: string;
  /** Whether our calendar manages the event; only then are guests counted. */
  readonly managed: boolean;
  readonly hosts: ReadonlyArray<LumaHost>;
  /** Guests going (approved): what the event page counts as "went". */
  readonly guestCount: number | null;
  /** Guests checked in at the door. */
  readonly checkedInCount: number | null;
}

/** What Luma's API answered could not be read. */
export class LumaApiResponseError extends Schema.TaggedError<LumaApiResponseError>()(
  "LumaApiResponseError",
  { lumaEventId: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Luma's answer for ${this.lumaEventId} is not an event as documented`;
  }
}

export type LumaApiError =
  | LumaUnavailable
  | LumaRejected
  | LumaApiResponseError;

/** An event's people from Luma's answer. */
export function toEventPeople(event: ApiEvent): LumaEventPeople {
  const counts = event.access === "manage" ? event.guest_counts : undefined;
  return {
    lumaEventId: event.id,
    managed: event.access === "manage",
    hosts: event.hosts.map((host) => ({
      lumaUserId: host.id,
      name: host.name,
      avatarUrl: host.avatar_url,
    })),
    guestCount: counts?.approved.guests ?? null,
    checkedInCount: counts?.checked_in.guests ?? null,
  };
}

export interface LumaApiShape {
  /**
   * The event's hosts and guest counts, or `None` where Luma does not show
   * us the event (403, or 404 for one deleted). `None` itself when
   * LUMA_API_KEY is not set.
   */
  readonly eventPeople: Option.Option<
    (
      lumaEventId: string,
    ) => Effect.Effect<Option.Option<LumaEventPeople>, LumaApiError>
  >;
}

const decodeEvent = Schema.decodeUnknownEffect(Schema.fromJsonString(ApiEvent));

const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const key = yield* apiKeyConfig;
  const redactedNames = yield* Headers.CurrentRedactedNames;

  const eventPeople = Option.map(
    key,
    (apiKey) => (lumaEventId: string) =>
      sendWithRetries(
        client,
        HttpClientRequest.get(`${apiOrigin}/v1/events/get`).pipe(
          HttpClientRequest.setUrlParams({ event_id: lumaEventId }),
          HttpClientRequest.setHeader(apiKeyHeader, Redacted.value(apiKey)),
          HttpClientRequest.acceptJson,
        ),
        "event",
      ).pipe(
        Effect.flatMap((body) =>
          decodeEvent(body).pipe(
            Effect.mapError(
              (cause) => new LumaApiResponseError({ lumaEventId, cause }),
            ),
          ),
        ),
        Effect.filterOrFail(
          (event) => event.id === lumaEventId,
          (event) =>
            new LumaApiResponseError({
              lumaEventId,
              cause: new Error(`Luma answered with ${event.id}`),
            }),
        ),
        Effect.map((event) => Option.some(toEventPeople(event))),
        Effect.catchTag("LumaRejected", (error) =>
          error.status === 403 || error.status === 404
            ? Effect.succeedNone
            : Effect.fail(error),
        ),
        Effect.provideService(Headers.CurrentRedactedNames, [
          ...redactedNames,
          apiKeyHeader,
        ]),
        Effect.withSpan("LumaApi.eventPeople", {
          attributes: { lumaEventId },
        }),
      ),
  );

  return LumaApi.of({ eventPeople });
});

export class LumaApi extends Context.Service<LumaApi, LumaApiShape>()(
  "allthings/LumaApi",
) {
  /** Needs an `HttpClient`: `FetchHttpClient.layer` in a Worker. */
  static readonly layer = Layer.effect(LumaApi, make);
}
