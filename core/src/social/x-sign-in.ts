import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Config,
  Context,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";

/**
 * Where @allthingswebdev's X sign-in is kept: its OAuth 2.0 refresh token,
 * in the 1Password item "allthings X app" (field "oauth2 refresh token") of
 * the vault "allthings". X spends a refresh token when it is used and
 * hands back the next one, so every sign-in reads it here and writes the
 * new one back before doing anything else.
 *
 * It is a secret: it is held Redacted, never printed, and reaches `op` in
 * a file only this user can read, removed right after (op ignores values
 * piped on stdin, and arguments show in the process list).
 *
 * The first token comes from xurl's store (`fromXurl`), where `xurl auth
 * oauth2` put it when @allthingswebdev authorized the app.
 */

export class SignInUnavailable extends Schema.TaggedError<SignInUnavailable>()(
  "SignInUnavailable",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

export const signInItem = {
  vault: "allthings",
  item: "allthings X app",
  field: "oauth2 refresh token",
} as const;

export interface XSignInShape {
  /** The stored refresh token, or None when there is none yet. */
  readonly read: Effect.Effect<
    Option.Option<Redacted.Redacted>,
    SignInUnavailable
  >;
  /** Stores `token` as the one to use next. */
  readonly write: (
    token: Redacted.Redacted,
  ) => Effect.Effect<void, SignInUnavailable>;
}

const ItemJson = Schema.Struct({
  id: Schema.String,
  fields: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.optionalKey(Schema.String),
      value: Schema.optionalKey(Schema.String),
    }),
  ),
});

/** The 1Password CLI, `op` (OP_BIN), signed in by OP_SERVICE_ACCOUNT_TOKEN. */
const onePassword = Effect.gen(function* () {
  const bin = yield* Config.String("OP_BIN").pipe(Config.withDefault("op"));
  const unavailable = (reason: string) => new SignInUnavailable({ reason });

  const op = (args: ReadonlyArray<string>, what: string) =>
    Effect.tryPromise({
      try: async () => {
        const child = Bun.spawn([bin, ...args], {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        if (code !== 0) throw new Error(stderr.trim() || `exit ${code}`);
        return stdout;
      },
      catch: (cause) =>
        unavailable(
          `1Password didn't ${what}: ${cause instanceof Error ? cause.message : String(cause)}`,
        ),
    });

  const item = op(
    [
      "item",
      "get",
      signInItem.item,
      "--vault",
      signInItem.vault,
      "--format",
      "json",
    ],
    `read "${signInItem.item}"`,
  ).pipe(
    Effect.flatMap((json) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(ItemJson))(json).pipe(
        Effect.mapError(() =>
          unavailable(`"${signInItem.item}" is not an item as op writes one`),
        ),
      ),
    ),
  );

  const read = item.pipe(
    Effect.map((parsed) => {
      const value = parsed.fields.find(
        (field) => field.label === signInItem.field,
      )?.value;
      return value === undefined || value === ""
        ? Option.none()
        : Option.some(Redacted.make(value));
    }),
  );

  const write = (token: Redacted.Redacted) =>
    Effect.gen(function* () {
      const json = yield* op(
        [
          "item",
          "get",
          signInItem.item,
          "--vault",
          signInItem.vault,
          "--format",
          "json",
        ],
        `read "${signInItem.item}"`,
      );
      const current = yield* Effect.try({
        try: () => {
          const parsed = JSON.parse(json) as {
            id?: unknown;
            fields?: unknown;
          };
          if (typeof parsed.id !== "string" || !Array.isArray(parsed.fields)) {
            throw new Error("not an item");
          }
          return parsed as {
            id: string;
            fields: Array<Record<string, unknown>>;
          };
        },
        catch: () =>
          unavailable(`"${signInItem.item}" is not an item as op writes one`),
      });
      const field = current.fields.find(
        (candidate) => candidate["label"] === signInItem.field,
      );
      if (field === undefined) {
        current.fields.push({
          id: "oauth2_refresh_token",
          label: signInItem.field,
          type: "CONCEALED",
          value: Redacted.value(token),
        });
      } else {
        field["value"] = Redacted.value(token);
      }
      yield* Effect.acquireUseRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "x-sign-in-"))),
        (dir) =>
          Effect.gen(function* () {
            const file = join(dir, "item.json");
            yield* Effect.promise(() =>
              writeFile(file, JSON.stringify(current), { mode: 0o600 }),
            );
            yield* op(
              [
                "item",
                "edit",
                current.id,
                "--vault",
                signInItem.vault,
                "--template",
                file,
              ],
              `store the new sign-in in "${signInItem.item}"`,
            );
          }),
        (dir) =>
          Effect.promise(() => rm(dir, { recursive: true, force: true })),
      );
    });

  return XSignIn.of({ read, write });
});

export class XSignIn extends Context.Service<XSignIn, XSignInShape>()(
  "allthings/XSignIn",
) {
  /** The 1Password item, through `op`. */
  static readonly onePassword = Layer.effect(XSignIn, onePassword);

  /** A token held in memory, for tests: `stored` is what it holds now. */
  static memory(initial: string | null) {
    const stored = { value: initial };
    const layer = Layer.succeed(
      XSignIn,
      XSignIn.of({
        read: Effect.sync(() =>
          stored.value === null
            ? Option.none()
            : Option.some(Redacted.make(stored.value)),
        ),
        write: (token) =>
          Effect.sync(() => {
            stored.value = Redacted.value(token);
          }),
      }),
    );
    return { layer, stored };
  }
}

const XurlStore = Schema.Struct({
  apps: Schema.Record(
    Schema.String,
    Schema.Struct({
      oauth2_tokens: Schema.optionalKey(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            oauth2: Schema.Struct({
              access_token: Schema.String,
              refresh_token: Schema.String,
              expiration_time: Schema.Number,
            }),
          }),
        ),
      ),
    }),
  ),
});

/**
 * The sign-in xurl stored for `user` of its app `app` (~/.xurl/auth.yml as
 * xurl writes it): both tokens, and when the access token expires.
 */
export const fromXurl = (yaml: string, app: string, user: string) =>
  Effect.gen(function* () {
    const store = yield* Effect.try({
      try: () => Bun.YAML.parse(yaml),
      catch: () =>
        new SignInUnavailable({ reason: "xurl's store is not YAML." }),
    }).pipe(
      Effect.flatMap((parsed) =>
        Schema.decodeUnknownEffect(XurlStore)(parsed).pipe(
          Effect.mapError(
            () =>
              new SignInUnavailable({
                reason: "xurl's store is not as xurl writes it.",
              }),
          ),
        ),
      ),
    );
    const tokens = store.apps[app]?.oauth2_tokens?.[user]?.oauth2;
    if (tokens === undefined) {
      return yield* new SignInUnavailable({
        reason: `xurl has no OAuth 2.0 sign-in for ${user} on its app "${app}": run xurl auth oauth2 --app ${app} ${user} first.`,
      });
    }
    return {
      access: Redacted.make(tokens.access_token),
      refresh: Redacted.make(tokens.refresh_token),
      expiresAt: tokens.expiration_time * 1000,
    };
  });
