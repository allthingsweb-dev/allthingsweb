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
 * post an evening's announcement as our account. Which posts went out is
 * kept in planning.sent_posts (src/social/sent-posts.ts), not read here.
 *
 * - `GET /2/tweets/:id` with the app's bearer token (X_BEARER_TOKEN): one
 *   post and its author, so that a post found on x.com after a create went
 *   unanswered can be recorded as the one sent. Each read is billed.
 * - `POST /2/oauth2/token` with `grant_type=refresh_token`, as the app
 *   (X_CLIENT_ID and X_CLIENT_SECRET, by HTTP Basic): an access token for
 *   two hours, and a new refresh token. The one used is spent, so the
 *   caller stores the new one before anything else.
 * - `GET /2/users/me` and `POST /2/tweets` with that access token: who it
 *   signs in as, and one post.
 *
 * A request is sent once. An answer that says X didn't do it (a 4xx) is
 * `refused`; no answer (none in 30 seconds counts as none), a 5xx, or a
 * 2xx we can't read is `unanswered`, for X may have.
 */

export const xApi = "https://api.x.com";

export class XUnavailable extends Schema.TaggedError<XUnavailable>()(
  "XUnavailable",
  {
    reason: Schema.String,
    /** `refused`: X answered that it didn't; `unanswered`: it may have. */
    outcome: Schema.Literals(["refused", "unanswered"]),
    /** The HTTP status X answered with, when it answered. */
    status: Schema.optionalKey(Schema.Number),
  },
) {
  override get message(): string {
    return this.reason;
  }
}

/** A post, as X reads it back: links shortened to t.co. */
export interface XPost {
  readonly id: string;
  readonly text: string;
  readonly authorId: string;
}

/** What a refresh gives: both are secrets, and the refresh token is new. */
export interface XTokens {
  readonly access: Redacted.Redacted;
  readonly refresh: Redacted.Redacted;
}

/** X answers a post it can't find with 200 and no `data`. */
const Lookup = Schema.Struct({
  data: Schema.optionalKey(
    Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      author_id: Schema.String,
    }),
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
  /** One post by id, with the app's token: None when X has no such post. */
  readonly lookup: (
    id: string,
  ) => Effect.Effect<Option.Option<XPost>, XUnavailable>;
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

  /** A failure before anything was sent: nothing happened. */
  const fail = (reason: string) =>
    Effect.fail(new XUnavailable({ reason, outcome: "refused" }));

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
        reason: `X ${response.status >= 500 ? "failed" : "refused"} ${what}: ${response.status}`,
        outcome: response.status >= 500 ? "unanswered" : "refused",
        status: response.status,
      });
    }).pipe(
      Effect.catchTag("HttpClientError", () =>
        Effect.fail(
          new XUnavailable({
            reason: `X didn't answer ${what}`,
            outcome: "unanswered",
          }),
        ),
      ),
      Effect.timeoutOrElse({
        duration: "30 seconds",
        orElse: () =>
          Effect.fail(
            new XUnavailable({
              reason: `X didn't answer ${what} in 30 seconds`,
              outcome: "unanswered",
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
              outcome: "unanswered",
            }),
        ),
      ) as Effect.Effect<S["Type"], XUnavailable>;

  const lookup = (id: string) =>
    Effect.gen(function* () {
      if (Option.isNone(bearer)) {
        return yield* fail("X_BEARER_TOKEN is not set: no post can be read.");
      }
      if (!/^\d{1,20}$/.test(id)) return Option.none<XPost>();
      const body = yield* send(
        HttpClientRequest.get(`${xApi}/2/tweets/${id}`).pipe(
          HttpClientRequest.bearerToken(Redacted.value(bearer.value)),
          HttpClientRequest.setUrlParams({ "tweet.fields": "author_id" }),
        ),
        "the post",
      ).pipe(
        Effect.map(Option.some),
        Effect.catchTag("XUnavailable", (error) =>
          error.status === 404 ? Effect.succeedNone : Effect.fail(error),
        ),
      );
      if (Option.isNone(body)) return Option.none<XPost>();
      const { data } = yield* decode(Lookup, "the post")(body.value);
      return data === undefined
        ? Option.none<XPost>()
        : Option.some({
            id: data.id,
            text: data.text,
            authorId: data.author_id,
          });
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

  return X.of({ lookup, refresh, me, post });
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
