import {
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import {
  Headers,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";
import { apiKeyConfig, apiKeyHeader, apiOrigin } from "../luma/api.ts";

/**
 * Where an event's cover is, by its Luma id, as the app finds it
 * (app/src/lib/event-covers/luma-cover.ts): Luma's API first, then, when the
 * API refuses (an event another calendar manages answers 403), the public
 * event data luma.com itself shows. A service, so tests fake it.
 */

/** Neither source could say where an event's cover is. */
export class CoverLookupError extends Schema.TaggedError<CoverLookupError>()(
  "CoverLookupError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

export interface CoverSourceShape {
  /**
   * Finds covers, or None without LUMA_API_KEY: the app skips covers
   * without it, and so does the sync.
   */
  readonly find: Option.Option<
    (lumaEventId: string) => Effect.Effect<string | null, CoverLookupError>
  >;
}

export class CoverSource extends Context.Service<
  CoverSource,
  CoverSourceShape
>()("allthings/CoverSource") {
  /** From Luma, with LUMA_API_KEY. Needs an `HttpClient`. */
  static readonly layer = Layer.effect(
    CoverSource,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const key = yield* apiKeyConfig;
      const redactedNames = yield* Headers.CurrentRedactedNames;
      return CoverSource.of({
        find: Option.map(
          key,
          (apiKey) => (lumaEventId: string) =>
            fromApi(client, apiKey, lumaEventId).pipe(
              Effect.catch((apiError) =>
                fromPublicData(client, lumaEventId).pipe(
                  Effect.mapError(
                    (publicError) =>
                      new CoverLookupError({
                        reason: `Luma API: ${apiError.message}; public event data: ${publicError.message}`,
                      }),
                  ),
                ),
              ),
              Effect.provideService(Headers.CurrentRedactedNames, [
                ...redactedNames,
                apiKeyHeader,
              ]),
            ),
        ),
      });
    }),
  );
}

const lookupTimeout = Duration.seconds(20);

const ApiCover = Schema.Struct({
  cover_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const PublicCover = Schema.Struct({
  event: Schema.Struct({
    cover_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
});

/** One request, once, as the app makes it: its JSON body, or why not. */
const getJson = <A>(
  client: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
  schema: Schema.Codec<A, unknown>,
  name: string,
) =>
  client.execute(HttpClientRequest.acceptJson(request)).pipe(
    Effect.flatMap(
      (
        response: HttpClientResponse.HttpClientResponse,
      ): Effect.Effect<unknown, unknown> =>
        response.status >= 200 && response.status < 300
          ? response.json
          : Effect.fail(
              new CoverLookupError({ reason: `${name} ${response.status}` }),
            ),
    ),
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.timeout(lookupTimeout),
    Effect.mapError((error) =>
      error instanceof CoverLookupError
        ? error
        : new CoverLookupError({
            reason: `${name}: ${error instanceof Error ? error.message : String(error)}`,
          }),
    ),
  );

const fromApi = (
  client: HttpClient.HttpClient,
  apiKey: Redacted.Redacted,
  lumaEventId: string,
) =>
  getJson(
    client,
    HttpClientRequest.get(`${apiOrigin}/v1/events/get`).pipe(
      HttpClientRequest.setUrlParams({ event_id: lumaEventId }),
      HttpClientRequest.setHeader(apiKeyHeader, Redacted.value(apiKey)),
    ),
    ApiCover,
    "Luma event",
  ).pipe(Effect.map((event) => event.cover_url || null));

const fromPublicData = (client: HttpClient.HttpClient, lumaEventId: string) =>
  getJson(
    client,
    HttpClientRequest.get("https://api.lu.ma/event/get").pipe(
      HttpClientRequest.setUrlParams({ event_api_id: lumaEventId }),
    ),
    PublicCover,
    "Luma public event",
  ).pipe(Effect.map(({ event }) => event.cover_url || null));
