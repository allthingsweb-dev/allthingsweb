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

/**
 * X's API v2, as docs.x.com documents it: what the event studio needs to
 * post an evening's announcement as our account, and to check it hasn't
 * already.
 *
 * - `GET /2/users/:id/tweets` with the app's bearer token (X_BEARER_TOKEN):
 *   the account's latest posts. It needs no sign-in, and each post read is
 *   billed, so it reads the last ten.
 * - `POST /2/oauth2/token` with `grant_type=refresh_token`, as the app
 *   (X_CLIENT_ID and X_CLIENT_SECRET, by HTTP Basic): an access token for
 *   two hours, and a new refresh token. The one used is spent, so the
 *   caller stores the new one before anything else.
 * - `GET /2/users/me` and `POST /2/tweets` with that access token: who it
 *   signs in as, and one post.
 *
 * A post is sent once: a create that went unanswered (no answer in 30
 * seconds counts as none) may have happened, so the caller reads the
 * account's posts before trying again.
 */

export const xApi = "https://api.x.com";

export class XUnavailable extends Schema.TaggedError<XUnavailable>()(
  "XUnavailable",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

/** A post of ours, as X lists it. */
export interface XPost {
  readonly id: string;
  readonly text: string;
}

/** What a refresh gives: both are secrets, and the refresh token is new. */
export interface XTokens {
  readonly access: Redacted.Redacted;
  readonly refresh: Redacted.Redacted;
}

const Timeline = Schema.Struct({
  data: Schema.optionalKey(
    Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String })),
  ),
});

const TokenBody = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
});

const Me = Schema.Struct({
  data: Schema.Struct({ id: Schema.String, username: Schema.String }),
});

const Created = Schema.Struct({
  data: Schema.Struct({ id: Schema.String, text: Schema.String }),
});

export interface XShape {
  /** The account's latest posts, newest first, replies and reposts left out. */
  readonly recentPosts: (
    userId: string,
  ) => Effect.Effect<ReadonlyArray<XPost>, XUnavailable>;
  /** Spends `refreshToken` for an access token and the next refresh token. */
  readonly refresh: (
    refreshToken: Redacted.Redacted,
  ) => Effect.Effect<XTokens, XUnavailable>;
  /** Who `access` signs in as. */
  readonly me: (
    access: Redacted.Redacted,
  ) => Effect.Effect<
    { readonly id: string; readonly username: string },
    XUnavailable
  >;
  /** Posts `text` as `access`'s account, once: the post's id. */
  readonly post: (
    access: Redacted.Redacted,
    text: string,
  ) => Effect.Effect<{ readonly id: string }, XUnavailable>;
}

const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const bearer = yield* Config.option(Config.Redacted("X_BEARER_TOKEN"));
  const app = yield* Config.option(
    Config.all({
      id: Config.Redacted("X_CLIENT_ID"),
      secret: Config.Redacted("X_CLIENT_SECRET"),
    }),
  );
  const redactedNames = yield* Headers.CurrentRedactedNames;

  const fail = (reason: string) => Effect.fail(new XUnavailable({ reason }));

  /** One request, sent once; its body, or why it failed. */
  const send = (
    request: HttpClientRequest.HttpClientRequest,
    what: string,
  ): Effect.Effect<string, XUnavailable> =>
    Effect.gen(function* () {
      const response = yield* client.execute(request);
      if (response.status >= 200 && response.status < 300) {
        return yield* response.text;
      }
      return yield* new XUnavailable({
        reason: `X refused ${what}: ${response.status}`,
      });
    }).pipe(
      Effect.catchTag("HttpClientError", () =>
        Effect.fail(new XUnavailable({ reason: `X didn't answer ${what}` })),
      ),
      Effect.timeoutOrElse({
        duration: "30 seconds",
        orElse: () =>
          Effect.fail(
            new XUnavailable({
              reason: `X didn't answer ${what} in 30 seconds`,
            }),
          ),
      }),
      Effect.provideService(Headers.CurrentRedactedNames, [
        ...redactedNames,
        "authorization",
      ]),
    );

  const decode =
    <S extends Schema.Top>(schema: S, what: string) =>
    (body: string): Effect.Effect<S["Type"], XUnavailable> =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(body).pipe(
        Effect.mapError(
          () =>
            new XUnavailable({
              reason: `X's answer to ${what} is not as documented`,
            }),
        ),
      ) as Effect.Effect<S["Type"], XUnavailable>;

  const recentPosts = (userId: string) =>
    Effect.gen(function* () {
      if (Option.isNone(bearer)) {
        return yield* fail(
          "X_BEARER_TOKEN is not set: our posts on X can't be read.",
        );
      }
      const body = yield* send(
        HttpClientRequest.get(
          `${xApi}/2/users/${encodeURIComponent(userId)}/tweets`,
        ).pipe(
          HttpClientRequest.bearerToken(Redacted.value(bearer.value)),
          HttpClientRequest.setUrlParams({
            max_results: "10",
            exclude: "replies,retweets",
          }),
        ),
        "the account's posts",
      );
      const { data } = yield* decode(Timeline, "the account's posts")(body);
      return data ?? [];
    });

  const refresh = (refreshToken: Redacted.Redacted) =>
    Effect.gen(function* () {
      if (Option.isNone(app)) {
        return yield* fail(
          "X_CLIENT_ID and X_CLIENT_SECRET are not set: nothing can be posted.",
        );
      }
      const basic = btoa(
        `${Redacted.value(app.value.id)}:${Redacted.value(app.value.secret)}`,
      );
      const body = yield* send(
        HttpClientRequest.post(`${xApi}/2/oauth2/token`).pipe(
          HttpClientRequest.setHeader("authorization", `Basic ${basic}`),
          HttpClientRequest.bodyUrlParams({
            grant_type: "refresh_token",
            refresh_token: Redacted.value(refreshToken),
          }),
        ),
        "the sign-in",
      );
      const tokens = yield* decode(TokenBody, "the sign-in")(body);
      return {
        access: Redacted.make(tokens.access_token),
        refresh: Redacted.make(tokens.refresh_token),
      } satisfies XTokens;
    });

  const me = (access: Redacted.Redacted) =>
    send(
      HttpClientRequest.get(`${xApi}/2/users/me`).pipe(
        HttpClientRequest.bearerToken(Redacted.value(access)),
      ),
      "who is signed in",
    ).pipe(
      Effect.flatMap(decode(Me, "who is signed in")),
      Effect.map(({ data }) => ({ id: data.id, username: data.username })),
    );

  const post = (access: Redacted.Redacted, text: string) =>
    send(
      HttpClientRequest.post(`${xApi}/2/tweets`).pipe(
        HttpClientRequest.bearerToken(Redacted.value(access)),
        HttpClientRequest.bodyJsonUnsafe({ text }),
      ),
      "the post",
    ).pipe(
      Effect.flatMap(decode(Created, "the post")),
      Effect.map(({ data }) => ({ id: data.id })),
    );

  return X.of({ recentPosts, refresh, me, post });
});

export class X extends Context.Service<X, XShape>()("allthings/X") {
  /** Needs an `HttpClient`: `FetchHttpClient.layer` from the CLI. */
  static readonly layer = Layer.effect(X, make);
}

/** A post's page on x.com. */
export const xPostUrl = (handle: string, id: string): string =>
  `https://x.com/${handle}/status/${id}`;

/**
 * A post's text as X lists it compared with ours: X shortens every link to
 * t.co and escapes &, < and >, so links count as one and entities are read.
 */
export const sameText = (listed: string, ours: string): boolean => {
  const plain = (text: string) =>
    text
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&")
      .replace(/https?:\/\/\S+/g, "<link>")
      .replace(/\s+/g, " ")
      .trim();
  return plain(listed) === plain(ours);
};
