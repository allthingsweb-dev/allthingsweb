import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Headers, HttpClient, HttpClientRequest } from "effect/http";
import { apiKeyConfig, apiKeyHeader, apiOrigin, LumaEventId } from "./api.ts";
import { LumaRejected, LumaUnavailable, sendWithRetries } from "./luma.ts";

/**
 * Writing to Luma through its official API (docs.luma.com, "Events" and
 * "Images"), with the calendar's key in LUMA_API_KEY: what the event studio
 * needs to make an evening's Luma event and put it out.
 *
 * - `POST /v1/events/create`: a new event; we only ever make private ones.
 * - `POST /v1/events/update`: change an event; `event_id` and the fields
 *   to change.
 * - `GET /v1/events/get`: the event as its manager sees it.
 * - `POST /v1/images/create-upload-url`, then a `PUT` of the bytes to the
 *   URL it gives: an image on images.lumacdn.com, the only host a cover
 *   may be on.
 * - `POST /v1/events/cancel/request`, then `POST /v1/events/cancel`:
 *   Luma's two-step cancel, which deletes the event for good. Only the
 *   studio's own test events are ever cancelled (see publish.ts).
 * - `GET /v1/calendars/get` and `POST /v1/calendars/update`: the calendar
 *   the key belongs to, and changing what its page says (calendar.ts).
 * - `GET /v1/events/ticket-types/list` and `POST
 *   /v1/events/ticket-types/update`: an event's ticket types, where Luma
 *   keeps whether registering needs approval (registration.ts).
 * - `POST /v1/events/hosts/add` and `POST /v1/events/hosts/remove`: an
 *   event's hosts, by email, each at an access level (hosts.ts).
 *
 * Reads are retried as every Luma request is (luma.ts). Writes are sent
 * once: a create or an update that timed out may have happened, and a
 * second one could make a second event, so the caller sees the failure
 * and checks Luma first.
 */

export class LumaWriteUnavailable extends Schema.TaggedError<LumaWriteUnavailable>()(
  "LumaWriteUnavailable",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

/** Where an event is: a place Google Maps finds, or an address as written. */
export type LumaPlace =
  | { readonly type: "lookup"; readonly query: string }
  | { readonly type: "manual"; readonly address: string };

/** The fields the studio sets on an event, as Luma names them. */
export interface LumaEventFields {
  readonly name?: string;
  readonly start_at?: string;
  readonly end_at?: string;
  readonly timezone?: string;
  readonly geo_address_json?: LumaPlace;
  readonly description_md?: string;
  readonly cover_url?: string;
  readonly slug?: string;
  readonly max_capacity?: number | null;
  readonly visibility?: "public" | "members-only" | "private";
  readonly waitlist_status?: "enabled" | "disabled";
  readonly registration_questions?: ReadonlyArray<LumaQuestion>;
}

/**
 * A registration question as Luma keeps it. Its type decides what else it
 * carries; the studio writes only `text` ones (registration.ts), so the
 * rest are read for what they are and never written back.
 */
export const LumaQuestion = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  required: Schema.Boolean,
  question_type: Schema.String,
  multiline: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
});
export type LumaQuestion = typeof LumaQuestion.Type;

/** A ticket type as `ticket-types/list` answers: where approval is kept. */
export const LumaTicketType = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  require_approval: Schema.Boolean,
  is_hidden: Schema.Boolean,
  type: Schema.String,
});
export type LumaTicketType = typeof LumaTicketType.Type;

/**
 * What `calendars/update` may change on the calendar, as Luma names it.
 * Its cover and its social preview image are not among them: Luma's API
 * can only read those.
 */
export interface CalendarFields {
  readonly name?: string;
  readonly slug?: string;
  readonly description?: string;
  readonly avatar_url?: string;
  readonly tint_color?: string;
  readonly website?: string | null;
  readonly instagram_handle?: string | null;
  readonly twitter_handle?: string | null;
  readonly youtube_handle?: string | null;
  readonly tiktok_handle?: string | null;
  readonly linkedin_handle?: string | null;
}

/** The calendar as `calendars/get` answers. */
export const ManagedCalendar = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.NullOr(Schema.String),
  url: Schema.String,
  description: Schema.NullOr(Schema.String),
  avatar_url: Schema.NullOr(Schema.String),
  cover_image_url: Schema.NullOr(Schema.String),
  social_image_url: Schema.NullOr(Schema.String),
  tint_color: Schema.NullOr(Schema.String),
  website: Schema.NullOr(Schema.String),
  instagram_handle: Schema.NullOr(Schema.String),
  twitter_handle: Schema.NullOr(Schema.String),
  youtube_handle: Schema.NullOr(Schema.String),
  tiktok_handle: Schema.NullOr(Schema.String),
  linkedin_handle: Schema.NullOr(Schema.String),
});
export type ManagedCalendar = typeof ManagedCalendar.Type;

/** One of an event's hosts, as `events/get` answers: with an email only to its manager. */
export const LumaHost = Schema.Struct({
  id: Schema.String,
  email: Schema.optionalKey(Schema.String),
  name: Schema.NullOr(Schema.String),
});
export type LumaHost = typeof LumaHost.Type;

/** An event as its manager sees it: what publishing reads and checks. */
export const ManagedEvent = Schema.Struct({
  id: LumaEventId,
  access: Schema.Literals(["manage", "view"]),
  name: Schema.String,
  start_at: Schema.String,
  end_at: Schema.NullOr(Schema.String),
  timezone: Schema.String,
  url: Schema.String,
  visibility: Schema.Literals(["public", "members-only", "private"]),
  cover_url: Schema.NullOr(Schema.String),
  description_md: Schema.optionalKey(Schema.NullOr(Schema.String)),
  geo_address_json: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        full_address: Schema.optionalKey(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  guest_counts: Schema.optionalKey(
    Schema.Struct({ approved: Schema.Struct({ guests: Schema.Number }) }),
  ),
  // Registration, as the manager sees it (registration.ts).
  require_approval: Schema.optionalKey(Schema.Boolean),
  waitlist_status: Schema.optionalKey(Schema.Literals(["enabled", "disabled"])),
  max_capacity: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  registration_questions: Schema.optionalKey(Schema.Array(LumaQuestion)),
  // Who made it, and its hosts, as the manager sees them (hosts.ts).
  user_id: Schema.optionalKey(Schema.String),
  hosts: Schema.optionalKey(Schema.Array(LumaHost)),
});
export type ManagedEvent = typeof ManagedEvent.Type;

const TicketTypes = Schema.Struct({ entries: Schema.Array(LumaTicketType) });

const Created = Schema.Struct({ id: LumaEventId });
const UploadUrl = Schema.Struct({
  upload_url: Schema.String,
  file_url: Schema.String.check(
    Schema.isPattern(/^https:\/\/images\.lumacdn\.com\//),
  ),
});
const CancelToken = Schema.Struct({
  cancellation_token: Schema.String,
  guest_count: Schema.Number,
});

/** What a write failed with: Luma refused it, didn't answer, or answered nonsense. */
export type LumaWriteError =
  | LumaRejected
  | LumaUnavailable
  | LumaWriteUnavailable;

export interface LumaWriteShape {
  readonly get: (
    lumaEventId: string,
  ) => Effect.Effect<ManagedEvent, LumaWriteError>;
  /** Makes an event; its id. */
  readonly create: (
    fields: LumaEventFields & {
      readonly name: string;
      readonly start_at: string;
      readonly timezone: string;
    },
  ) => Effect.Effect<string, LumaWriteError>;
  readonly update: (
    lumaEventId: string,
    fields: LumaEventFields,
  ) => Effect.Effect<void, LumaWriteError>;
  /** Puts an image on Luma's CDN; its URL there, for `cover_url`. */
  readonly uploadImage: (
    bytes: Uint8Array,
    contentType: "image/jpeg" | "image/png",
  ) => Effect.Effect<string, LumaWriteError>;
  /** The event's ticket types, hidden ones too. */
  readonly ticketTypes: (
    lumaEventId: string,
  ) => Effect.Effect<ReadonlyArray<LumaTicketType>, LumaWriteError>;
  /** Turns approval on or off for one ticket type. */
  readonly setTicketApproval: (
    ticketTypeId: string,
    requireApproval: boolean,
  ) => Effect.Effect<void, LumaWriteError>;
  /**
   * Adds a host by email, at an access level; shown on the page unless
   * only for check-in, which Luma never shows.
   */
  readonly addHost: (
    lumaEventId: string,
    email: string,
    accessLevel: "none" | "check-in" | "manager",
  ) => Effect.Effect<void, LumaWriteError>;
  /** Removes a host by email. */
  readonly removeHost: (
    lumaEventId: string,
    email: string,
  ) => Effect.Effect<void, LumaWriteError>;
  /** Cancels the event, which deletes it: Luma's two steps. */
  readonly cancel: (lumaEventId: string) => Effect.Effect<void, LumaWriteError>;
  /** The calendar the key belongs to. */
  readonly getCalendar: () => Effect.Effect<ManagedCalendar, LumaWriteError>;
  readonly updateCalendar: (
    calendarId: string,
    fields: CalendarFields,
  ) => Effect.Effect<void, LumaWriteError>;
}

const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const key = yield* apiKeyConfig;
  const redactedNames = yield* Headers.CurrentRedactedNames;

  const authorized = (
    request: HttpClientRequest.HttpClientRequest,
  ): Effect.Effect<
    HttpClientRequest.HttpClientRequest,
    LumaWriteUnavailable
  > =>
    Option.isNone(key)
      ? Effect.fail(
          new LumaWriteUnavailable({
            reason: "LUMA_API_KEY is not set: nothing can be written to Luma.",
          }),
        )
      : Effect.succeed(
          request.pipe(
            HttpClientRequest.setHeader(
              apiKeyHeader,
              Redacted.value(key.value),
            ),
            HttpClientRequest.acceptJson,
          ),
        );

  const withRedaction = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(Headers.CurrentRedactedNames, [
        ...redactedNames,
        apiKeyHeader,
      ]),
    );

  const decode =
    <S extends Schema.Top>(schema: S, what: string) =>
    (body: string): Effect.Effect<S["Type"], LumaWriteUnavailable> =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(body).pipe(
        Effect.mapError(
          () =>
            new LumaWriteUnavailable({
              reason: `Luma's answer to ${what} is not what docs.luma.com documents.`,
            }),
        ),
      ) as Effect.Effect<S["Type"], LumaWriteUnavailable>;

  /** A write, sent once: see the module's note. */
  const sendOnce = (
    request: HttpClientRequest.HttpClientRequest,
    resource: "event" | "calendar" = "event",
  ): Effect.Effect<string, LumaRejected | LumaUnavailable> =>
    Effect.gen(function* () {
      const response = yield* client.execute(request);
      if (response.status >= 200 && response.status < 300) {
        return yield* response.text;
      }
      if (response.status === 429 || response.status >= 500) {
        return yield* new LumaUnavailable({
          status: response.status,
          retryAfter: null,
          resource,
        });
      }
      const text = yield* response.text;
      yield* Effect.logWarning(`Luma refused a write: ${text.slice(0, 500)}`);
      return yield* new LumaRejected({ status: response.status, resource });
    }).pipe(
      Effect.catchTag("HttpClientError", (cause) =>
        Effect.fail(
          new LumaUnavailable({
            status: null,
            retryAfter: null,
            cause,
            resource,
          }),
        ),
      ),
    );

  const post = (
    path: string,
    body: unknown,
    resource: "event" | "calendar" = "event",
  ): Effect.Effect<string, LumaWriteError> =>
    authorized(
      HttpClientRequest.post(`${apiOrigin}${path}`).pipe(
        HttpClientRequest.bodyJsonUnsafe(body),
      ),
    ).pipe(
      Effect.flatMap((request) => sendOnce(request, resource)),
      withRedaction,
    );

  const get = (
    lumaEventId: string,
  ): Effect.Effect<ManagedEvent, LumaWriteError> =>
    authorized(
      HttpClientRequest.get(`${apiOrigin}/v1/events/get`).pipe(
        HttpClientRequest.setUrlParams({ event_id: lumaEventId }),
      ),
    ).pipe(
      Effect.flatMap((request) => sendWithRetries(client, request, "event")),
      Effect.flatMap(decode(ManagedEvent, "events/get")),
      withRedaction,
    );

  return LumaWrite.of({
    get,
    create: (fields) =>
      post("/v1/events/create", fields).pipe(
        Effect.flatMap(decode(Created, "events/create")),
        Effect.map(({ id }) => id),
      ),
    update: (lumaEventId, fields) =>
      post("/v1/events/update", { event_id: lumaEventId, ...fields }).pipe(
        Effect.asVoid,
      ),
    uploadImage: (bytes, contentType) =>
      Effect.gen(function* () {
        const { upload_url, file_url } = yield* post(
          "/v1/images/create-upload-url",
          { content_type: contentType },
        ).pipe(Effect.flatMap(decode(UploadUrl, "images/create-upload-url")));
        // The upload URL carries its own signature: no key goes to it.
        yield* sendOnce(
          HttpClientRequest.put(upload_url).pipe(
            HttpClientRequest.bodyUint8Array(bytes, contentType),
          ),
        );
        return file_url;
      }),
    ticketTypes: (lumaEventId) =>
      authorized(
        HttpClientRequest.get(`${apiOrigin}/v1/events/ticket-types/list`).pipe(
          HttpClientRequest.setUrlParams({
            event_id: lumaEventId,
            include_hidden: "true",
          }),
        ),
      ).pipe(
        Effect.flatMap((request) => sendWithRetries(client, request, "event")),
        Effect.flatMap(decode(TicketTypes, "events/ticket-types/list")),
        Effect.map(({ entries }) => entries),
        withRedaction,
      ),
    setTicketApproval: (ticketTypeId, requireApproval) =>
      post("/v1/events/ticket-types/update", {
        event_ticket_type_id: ticketTypeId,
        require_approval: requireApproval,
      }).pipe(Effect.asVoid),
    addHost: (lumaEventId, email, accessLevel) =>
      post("/v1/events/hosts/add", {
        event_id: lumaEventId,
        email,
        access_level: accessLevel,
      }).pipe(Effect.asVoid),
    removeHost: (lumaEventId, email) =>
      post("/v1/events/hosts/remove", { event_id: lumaEventId, email }).pipe(
        Effect.asVoid,
      ),
    cancel: (lumaEventId) =>
      Effect.gen(function* () {
        const { cancellation_token } = yield* post(
          "/v1/events/cancel/request",
          { event_id: lumaEventId },
        ).pipe(Effect.flatMap(decode(CancelToken, "events/cancel/request")));
        yield* post("/v1/events/cancel", {
          event_id: lumaEventId,
          cancellation_token,
        });
      }),
    getCalendar: () =>
      authorized(HttpClientRequest.get(`${apiOrigin}/v1/calendars/get`)).pipe(
        Effect.flatMap((request) =>
          sendWithRetries(client, request, "calendar"),
        ),
        Effect.flatMap(decode(ManagedCalendar, "calendars/get")),
        withRedaction,
      ),
    updateCalendar: (calendarId, fields) =>
      post(
        "/v1/calendars/update",
        { calendar_id: calendarId, ...fields },
        "calendar",
      ).pipe(Effect.asVoid),
  });
});

export class LumaWrite extends Context.Service<LumaWrite, LumaWriteShape>()(
  "allthings/LumaWrite",
) {
  /** Needs an `HttpClient`: `FetchHttpClient.layer` from the CLI. */
  static readonly layer = Layer.effect(LumaWrite, make);
}
