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
  readonly max_capacity?: number;
  readonly visibility?: "public" | "members-only" | "private";
}

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
});
export type ManagedEvent = typeof ManagedEvent.Type;

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
  /** Cancels the event, which deletes it: Luma's two steps. */
  readonly cancel: (lumaEventId: string) => Effect.Effect<void, LumaWriteError>;
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
          resource: "event",
        });
      }
      const text = yield* response.text;
      yield* Effect.logWarning(`Luma refused a write: ${text.slice(0, 500)}`);
      return yield* new LumaRejected({
        status: response.status,
        resource: "event",
      });
    }).pipe(
      Effect.catchTag("HttpClientError", (cause) =>
        Effect.fail(
          new LumaUnavailable({
            status: null,
            retryAfter: null,
            cause,
            resource: "event",
          }),
        ),
      ),
    );

  const post = (
    path: string,
    body: unknown,
  ): Effect.Effect<string, LumaWriteError> =>
    authorized(
      HttpClientRequest.post(`${apiOrigin}${path}`).pipe(
        HttpClientRequest.bodyJsonUnsafe(body),
      ),
    ).pipe(Effect.flatMap(sendOnce), withRedaction);

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
  });
});

export class LumaWrite extends Context.Service<LumaWrite, LumaWriteShape>()(
  "allthings/LumaWrite",
) {
  /** Needs an `HttpClient`: `FetchHttpClient.layer` from the CLI. */
  static readonly layer = Layer.effect(LumaWrite, make);
}
