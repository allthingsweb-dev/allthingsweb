import {
  Config,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import {
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";

/**
 * The edge's half of who may sign in to the draft preview (README,
 * "Collaborating on a draft"): the Zero Trust email list "allthings draft
 * collaborators", which the preview's Access policy admits besides the
 * organizers (infra/src/preview.ts). The studio keeps it equal to every
 * active invitation's email whenever it invites or revokes, and revoking
 * also ends that person's Access sessions, so a revoked collaborator signs
 * in again and is turned away at the edge, besides the Worker's own check
 * on every request.
 *
 * Alchemy declares neither the list nor its items: it reconciles a list's
 * items as the full set on every deploy, which would empty this one. The
 * list is made once by infra/scripts/zero-trust-token.sh, found here by its
 * name, and its id is set in the stack.
 *
 * It calls Cloudflare's API with the studio's own token,
 * CLOUDFLARE_ZERO_TRUST_TOKEN ("allthings zero trust" in 1Password, made by
 * infra/scripts/zero-trust-token.sh), which may write Zero Trust lists and
 * revoke Access sessions in the allthings account, and nothing else.
 * Nothing prints it.
 */

export const ACCOUNT_ID = "af627f300cd00c4dca56aacf05bea050";
export const COLLABORATOR_LIST = "allthings draft collaborators";

const cloudflareApi = "https://api.cloudflare.com/client/v4";

/**
 * Where the API is: Cloudflare's, unless CLOUDFLARE_API_BASE names a server
 * on this machine (http://127.0.0.1:<port>), as the CLI's tests do. Nothing
 * else is taken, so the token can't be sent anywhere but Cloudflare or here.
 */
export function apiBase(override: string | undefined): string | AccessError {
  if (override === undefined || override === "") return cloudflareApi;
  return /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(override)
    ? override
    : new AccessError({
        reason: `CLOUDFLARE_API_BASE may only name http://127.0.0.1:<port>, for tests; it is "${override}".`,
      });
}

/** Cloudflare refused, or didn't answer; what was written to the database stays. */
export class AccessError extends Schema.TaggedError<AccessError>()(
  "AccessError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

/** What a sync changed on the list. */
export interface ListSync {
  readonly listId: string;
  readonly added: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
}

export interface AccessListShape {
  /** Fails unless the token is there: checked before anything is written. */
  readonly ready: Effect.Effect<void, AccessError>;
  /** What setting the list to `emails` would change, changing nothing. */
  readonly plan: (
    emails: ReadonlyArray<string>,
  ) => Effect.Effect<ListSync, AccessError>;
  /** Sets the list to exactly `emails`. */
  readonly sync: (
    emails: ReadonlyArray<string>,
  ) => Effect.Effect<ListSync, AccessError>;
  /** Ends every Access session `email` holds in the team. */
  readonly revokeSessions: (email: string) => Effect.Effect<void, AccessError>;
}

const Envelope = Schema.Struct({
  success: Schema.optionalKey(Schema.Boolean),
  errors: Schema.optionalKey(
    Schema.Array(Schema.Struct({ message: Schema.String })),
  ),
  result: Schema.optionalKey(Schema.Unknown),
});

const Lists = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    type: Schema.String,
  }),
);
const ListWithItems = Schema.Struct({
  items: Schema.optionalKey(
    Schema.NullOr(Schema.Array(Schema.Struct({ value: Schema.String }))),
  ),
});

/** The two sets' difference, sorted: what to add and what to remove. */
export function difference(
  current: ReadonlyArray<string>,
  wanted: ReadonlyArray<string>,
): {
  readonly added: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
} {
  const have = new Set(current.map((email) => email.toLowerCase()));
  const want = new Set(wanted.map((email) => email.toLowerCase()));
  return {
    added: [...want].filter((email) => !have.has(email)).toSorted(),
    removed: [...have].filter((email) => !want.has(email)).toSorted(),
  };
}

export class AccessList extends Context.Service<AccessList, AccessListShape>()(
  "allthings/AccessList",
) {
  /** Cloudflare's API, with CLOUDFLARE_ZERO_TRUST_TOKEN. Needs an `HttpClient`. */
  static readonly cloudflare = Layer.effect(
    AccessList,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const base = apiBase(
        yield* Config.String("CLOUDFLARE_API_BASE").pipe(
          Config.withDefault(""),
        ),
      );
      if (base instanceof AccessError) return yield* base;
      const api = `${base}/accounts/${ACCOUNT_ID}`;
      // Read once, with the layer; missing, every call is refused before
      // it sends anything.
      const given = yield* Config.option(
        Config.Redacted("CLOUDFLARE_ZERO_TRUST_TOKEN"),
      );
      const token = Option.match(given, {
        onNone: () =>
          Effect.fail(
            new AccessError({
              reason:
                'CLOUDFLARE_ZERO_TRUST_TOKEN is not set: pass it from 1Password ("allthings zero trust") without printing it. Nothing was written.',
            }),
          ),
        onSome: (secret) =>
          Redacted.value(secret).trim() === ""
            ? Effect.fail(
                new AccessError({
                  reason:
                    "CLOUDFLARE_ZERO_TRUST_TOKEN is blank. Nothing was written.",
                }),
              )
            : Effect.succeed(secret),
      });

      const call = (
        what: string,
        request: HttpClientRequest.HttpClientRequest,
      ) =>
        Effect.gen(function* () {
          const secret = yield* token;
          const response: HttpClientResponse.HttpClientResponse =
            yield* client.execute(
              request.pipe(
                HttpClientRequest.bearerToken(Redacted.value(secret)),
                HttpClientRequest.acceptJson,
              ),
            );
          const body = yield* response.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Envelope)),
            Effect.mapError(
              () =>
                new AccessError({
                  reason: `${what}: Cloudflare answered ${response.status} with no API envelope`,
                }),
            ),
          );
          if (body.success === false || response.status >= 400) {
            return yield* new AccessError({
              reason: `${what}: Cloudflare answered ${response.status}: ${(body.errors ?? []).map((e) => e.message).join("; ") || "no reason given"}`,
            });
          }
          return body.result;
        }).pipe(
          Effect.timeout(Duration.seconds(20)),
          Effect.catchTags({
            HttpClientError: () =>
              Effect.fail(new AccessError({ reason: `${what}: no answer` })),
            TimeoutError: () =>
              Effect.fail(
                new AccessError({ reason: `${what}: no answer in 20 s` }),
              ),
          }),
        );

      const decode =
        <S extends Schema.Top>(what: string, schema: S) =>
        (raw: unknown) =>
          Schema.decodeUnknownEffect(schema)(raw).pipe(
            Effect.mapError(
              () =>
                new AccessError({ reason: `${what}: an answer we can't read` }),
            ),
          );

      const listId = Effect.gen(function* () {
        const lists = yield* call(
          "listing Zero Trust lists",
          HttpClientRequest.get(`${api}/gateway/lists`),
        ).pipe(Effect.flatMap(decode("listing Zero Trust lists", Lists)));
        const found = lists.filter((list) => list.name === COLLABORATOR_LIST);
        const [list, ...others] = found;
        if (list === undefined) {
          return yield* new AccessError({
            reason: `The Zero Trust list "${COLLABORATOR_LIST}" doesn't exist: infra/scripts/zero-trust-token.sh makes it.`,
          });
        }
        if (others.length > 0 || list.type !== "EMAIL") {
          return yield* new AccessError({
            reason: `"${COLLABORATOR_LIST}" must be one email list; found ${found.map((l) => `${l.id} (${l.type})`).join(", ")}.`,
          });
        }
        return list.id;
      });

      const current = (id: string) =>
        call(
          "reading the collaborators list",
          HttpClientRequest.get(`${api}/gateway/lists/${id}`),
        ).pipe(
          Effect.flatMap(
            decode("reading the collaborators list", ListWithItems),
          ),
          Effect.map((list) => (list.items ?? []).map((item) => item.value)),
        );

      const plan: AccessListShape["plan"] = (emails) =>
        Effect.gen(function* () {
          const id = yield* listId;
          return { listId: id, ...difference(yield* current(id), emails) };
        });

      const sync: AccessListShape["sync"] = (emails) =>
        Effect.gen(function* () {
          const planned = yield* plan(emails);
          if (planned.added.length === 0 && planned.removed.length === 0) {
            return planned;
          }
          yield* call(
            "setting the collaborators list",
            HttpClientRequest.put(
              `${api}/gateway/lists/${planned.listId}`,
            ).pipe(
              HttpClientRequest.bodyJsonUnsafe({
                name: COLLABORATOR_LIST,
                description:
                  "Every active draft collaborator's email, set by bun run collab (core/src/collab/access.ts). Not managed by Alchemy.",
                items: [...new Set(emails.map((e) => e.toLowerCase()))]
                  .toSorted()
                  .map((value) => ({ value })),
              }),
            ),
          );
          return planned;
        });

      const revokeSessions: AccessListShape["revokeSessions"] = (email) =>
        call(
          `ending ${email}'s Access sessions`,
          HttpClientRequest.post(
            `${api}/access/organizations/revoke_user`,
          ).pipe(HttpClientRequest.bodyJsonUnsafe({ email })),
        ).pipe(Effect.asVoid);

      return AccessList.of({
        ready: Effect.asVoid(token),
        plan,
        sync,
        revokeSessions,
      });
    }),
  );
}
