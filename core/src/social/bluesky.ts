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
 * Bluesky through the AT Protocol, as bsky.network/docs documents it: what
 * the event studio needs to post an evening's announcement from our
 * account, and to check it hasn't already.
 *
 * - `com.atproto.server.createSession` on the entryway (bsky.social) with
 *   the account's handle and an app password (BLUESKY_HANDLE,
 *   BLUESKY_APP_PASSWORD): an access token, the account's DID, and the
 *   PDS that holds its repository.
 * - `com.atproto.repo.createRecord` on that PDS: one `app.bsky.feed.post`.
 * - `com.atproto.identity.resolveHandle` and `app.bsky.feed.getAuthorFeed`
 *   on the public AppView, which need no key: a mentioned handle's DID, and
 *   the account's recent posts.
 *
 * Links and mentions in a post's text are facets, by UTF-8 byte offsets
 * ({@link facetsOf}). A post is sent once: a create that timed out may
 * have happened, so the caller checks the feed before trying again.
 */

export const entryway = "https://bsky.social";
export const appView = "https://public.api.bsky.app";

export class BlueskyUnavailable extends Schema.TaggedError<BlueskyUnavailable>()(
  "BlueskyUnavailable",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

/** A link or a mention in a post, as `app.bsky.richtext.facet` writes one. */
export type Facet = {
  readonly index: { readonly byteStart: number; readonly byteEnd: number };
  readonly features: ReadonlyArray<
    | { readonly $type: "app.bsky.richtext.facet#link"; readonly uri: string }
    | {
        readonly $type: "app.bsky.richtext.facet#mention";
        readonly did: string;
      }
  >;
};

const bytes = (text: string): number => new TextEncoder().encode(text).length;

/** Trailing punctuation that ends a sentence, not a URL. */
const trailing = /[.,;:!?)]+$/;

/** Where `text` names a URL or a handle, by UTF-8 byte offsets, in order. */
export function spansOf(text: string): ReadonlyArray<{
  readonly kind: "link" | "mention";
  readonly value: string;
  readonly byteStart: number;
  readonly byteEnd: number;
}> {
  const spans: Array<{
    kind: "link" | "mention";
    value: string;
    byteStart: number;
    byteEnd: number;
  }> = [];
  for (const match of text.matchAll(/https?:\/\/[^\s]+/g)) {
    const value = match[0].replace(trailing, "");
    const start = match.index;
    spans.push({
      kind: "link",
      value,
      byteStart: bytes(text.slice(0, start)),
      byteEnd: bytes(text.slice(0, start + value.length)),
    });
  }
  for (const match of text.matchAll(
    /(?<=^|[\s(])@((?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})/g,
  )) {
    const handle = match[1] ?? "";
    const start = match.index;
    spans.push({
      kind: "mention",
      value: handle.toLowerCase(),
      byteStart: bytes(text.slice(0, start)),
      byteEnd: bytes(text.slice(0, start + match[0].length)),
    });
  }
  return spans.toSorted((a, b) => a.byteStart - b.byteStart);
}

/**
 * The facets for `text`: every link, and every mention whose handle
 * `dids` resolves. A handle it doesn't stays plain text.
 */
export function facetsOf(
  text: string,
  dids: ReadonlyMap<string, string>,
): ReadonlyArray<Facet> {
  return spansOf(text).flatMap((span): Array<Facet> => {
    const index = { byteStart: span.byteStart, byteEnd: span.byteEnd };
    if (span.kind === "link") {
      return [
        {
          index,
          features: [
            { $type: "app.bsky.richtext.facet#link", uri: span.value },
          ],
        },
      ];
    }
    const did = dids.get(span.value);
    return did === undefined
      ? []
      : [
          {
            index,
            features: [{ $type: "app.bsky.richtext.facet#mention", did }],
          },
        ];
  });
}

/** A post as `app.bsky.feed.post` stores it, but its time. */
export interface PostContent {
  readonly text: string;
  readonly facets: ReadonlyArray<Facet>;
  readonly langs: ReadonlyArray<string>;
}

const Session = Schema.Struct({
  accessJwt: Schema.String,
  did: Schema.String,
  didDoc: Schema.optionalKey(
    Schema.Struct({
      service: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            id: Schema.String,
            type: Schema.String,
            serviceEndpoint: Schema.String,
          }),
        ),
      ),
    }),
  ),
});

const Resolved = Schema.Struct({ did: Schema.String });

const Feed = Schema.Struct({
  feed: Schema.Array(
    Schema.Struct({
      post: Schema.Struct({
        uri: Schema.String,
        record: Schema.Struct({ text: Schema.optionalKey(Schema.String) }),
      }),
    }),
  ),
});

const Created = Schema.Struct({ uri: Schema.String, cid: Schema.String });

/** A post of ours, as the feed lists it. */
export interface PostedPost {
  readonly uri: string;
  readonly text: string;
}

export interface BlueskyShape {
  /** The DID a handle names, or None when it names none. */
  readonly resolveHandle: (
    handle: string,
  ) => Effect.Effect<Option.Option<string>, BlueskyUnavailable>;
  /** The account's recent posts, newest first. */
  readonly recentPosts: (
    did: string,
  ) => Effect.Effect<ReadonlyArray<PostedPost>, BlueskyUnavailable>;
  /** Signs in with the app password: the account's DID. */
  readonly account: Effect.Effect<
    { readonly did: string; readonly handle: string },
    BlueskyUnavailable
  >;
  /** Posts `content` as the account, once: its URI. */
  readonly post: (
    content: PostContent,
    createdAt: string,
  ) => Effect.Effect<{ readonly uri: string }, BlueskyUnavailable>;
}

const credentials = Config.option(
  Config.all({
    handle: Config.String("BLUESKY_HANDLE"),
    password: Config.Redacted("BLUESKY_APP_PASSWORD"),
  }),
);

const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const login = yield* credentials;
  const redactedNames = yield* Headers.CurrentRedactedNames;

  const fail = (reason: string) =>
    Effect.fail(new BlueskyUnavailable({ reason }));

  /** One request, sent once; its body, or why it failed. */
  const send = (
    request: HttpClientRequest.HttpClientRequest,
    what: string,
  ): Effect.Effect<string, BlueskyUnavailable> =>
    Effect.gen(function* () {
      const response = yield* client.execute(request);
      if (response.status >= 200 && response.status < 300) {
        return yield* response.text;
      }
      return yield* new BlueskyUnavailable({
        reason: `Bluesky refused ${what}: ${response.status}`,
      });
    }).pipe(
      Effect.catchTag("HttpClientError", () =>
        Effect.fail(
          new BlueskyUnavailable({ reason: `Bluesky didn't answer ${what}` }),
        ),
      ),
      Effect.provideService(Headers.CurrentRedactedNames, [
        ...redactedNames,
        "authorization",
      ]),
    );

  const decode =
    <S extends Schema.Top>(schema: S, what: string) =>
    (body: string): Effect.Effect<S["Type"], BlueskyUnavailable> =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(body).pipe(
        Effect.mapError(
          () =>
            new BlueskyUnavailable({
              reason: `Bluesky's answer to ${what} is not as documented`,
            }),
        ),
      ) as Effect.Effect<S["Type"], BlueskyUnavailable>;

  const session = Effect.gen(function* () {
    if (Option.isNone(login)) {
      return yield* fail(
        "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD are not set: nothing can be posted.",
      );
    }
    const { handle, password } = login.value;
    const created = yield* send(
      HttpClientRequest.post(
        `${entryway}/xrpc/com.atproto.server.createSession`,
      ).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          identifier: handle,
          password: Redacted.value(password),
        }),
      ),
      "the sign-in",
    ).pipe(Effect.flatMap(decode(Session, "createSession")));
    const pds =
      created.didDoc?.service?.find((service) => service.id === "#atproto_pds")
        ?.serviceEndpoint ?? entryway;
    return { ...created, handle, pds };
  });

  const resolveHandle = (handle: string) =>
    send(
      HttpClientRequest.get(
        `${appView}/xrpc/com.atproto.identity.resolveHandle`,
      ).pipe(HttpClientRequest.setUrlParams({ handle })),
      `the handle ${handle}`,
    ).pipe(
      Effect.flatMap(decode(Resolved, "resolveHandle")),
      Effect.map(({ did }) => Option.some(did)),
      Effect.catchTag("BlueskyUnavailable", (error) =>
        error.reason.endsWith(": 400")
          ? Effect.succeedNone
          : Effect.fail(error),
      ),
    );

  const recentPosts = (did: string) =>
    send(
      HttpClientRequest.get(`${appView}/xrpc/app.bsky.feed.getAuthorFeed`).pipe(
        HttpClientRequest.setUrlParams({
          actor: did,
          limit: "50",
          filter: "posts_no_replies",
        }),
      ),
      "the account's feed",
    ).pipe(
      Effect.flatMap(decode(Feed, "getAuthorFeed")),
      Effect.map(({ feed }) =>
        feed.map(({ post }) => ({
          uri: post.uri,
          text: post.record.text ?? "",
        })),
      ),
    );

  const post = (content: PostContent, createdAt: string) =>
    Effect.gen(function* () {
      const signedIn = yield* session;
      const created = yield* send(
        HttpClientRequest.post(
          `${signedIn.pds}/xrpc/com.atproto.repo.createRecord`,
        ).pipe(
          HttpClientRequest.bearerToken(signedIn.accessJwt),
          HttpClientRequest.bodyJsonUnsafe({
            repo: signedIn.did,
            collection: "app.bsky.feed.post",
            record: {
              $type: "app.bsky.feed.post",
              text: content.text,
              ...(content.facets.length === 0
                ? {}
                : { facets: content.facets }),
              langs: content.langs,
              createdAt,
            },
          }),
        ),
        "the post",
      ).pipe(Effect.flatMap(decode(Created, "createRecord")));
      return { uri: created.uri };
    });

  return Bluesky.of({
    resolveHandle,
    recentPosts,
    account: Effect.map(session, ({ did, handle }) => ({ did, handle })),
    post,
  });
});

export class Bluesky extends Context.Service<Bluesky, BlueskyShape>()(
  "allthings/Bluesky",
) {
  /** Needs an `HttpClient`: `FetchHttpClient.layer` from the CLI. */
  static readonly layer = Layer.effect(Bluesky, make);
}

/** A post's page on bsky.app, from its URI. */
export const postUrl = (handle: string, uri: string): string =>
  `https://bsky.app/profile/${handle}/post/${uri.split("/").at(-1) ?? ""}`;
