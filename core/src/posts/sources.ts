import {
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Schedule,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import {
  canonicalUrl,
  linkedinPostedAt,
  type PostRef,
  parsePostUrl,
} from "./urls.ts";

/**
 * What a post says and who wrote it, read from public sources that need no
 * key:
 * - X: the FixTweet API (api.fxtwitter.com), which serves a public post as
 *   JSON. X's own API needs a paid key; this is the keyless path until one
 *   exists.
 * - Bluesky: the public AppView (public.api.bsky.app), `getPostThread`.
 * - LinkedIn: nothing public serves a post, so its text and author come
 *   from whoever adds it; only the time is read, from the post's id.
 *
 * A failure the host may recover from (no answer in time, a dropped
 * connection, 429, 5xx) is tried again twice; anything else fails at once.
 */

/** A post as stored: everything the page shows, images as source URLs. */
export interface ResolvedPost {
  readonly platform: "x" | "bluesky" | "linkedin";
  readonly url: string;
  readonly authorName: string;
  readonly authorHandle: string | null;
  readonly authorUrl: string | null;
  readonly authorAvatarSourceUrl: string | null;
  readonly postedAt: DateTime.Utc;
  readonly text: string;
  readonly imageSourceUrl: string | null;
}

/** What only a person can say about a LinkedIn post. */
export interface ManualPost {
  readonly authorName: string;
  readonly authorUrl: string | null;
  readonly text: string;
}

/** The post could not be read; nothing is stored. */
export class PostSourceError extends Schema.TaggedError<PostSourceError>()(
  "PostSourceError",
  {
    url: Schema.String,
    reason: Schema.String,
    /** Whether trying again may help: no answer in time, 429 or a 5xx. */
    retryable: Schema.optionalKey(Schema.Boolean),
  },
) {
  override get message(): string {
    return `${this.url}: ${this.reason}`;
  }
}

const FxTweet = Schema.Struct({
  code: Schema.Int,
  tweet: Schema.Struct({
    id: Schema.String,
    text: Schema.String,
    created_timestamp: Schema.Int,
    author: Schema.Struct({
      name: Schema.String,
      screen_name: Schema.String,
      avatar_url: Schema.NullOr(Schema.String),
    }),
    media: Schema.optionalKey(
      Schema.Struct({
        photos: Schema.optionalKey(
          Schema.Array(Schema.Struct({ url: Schema.String })),
        ),
        videos: Schema.optionalKey(
          Schema.Array(Schema.Struct({ thumbnail_url: Schema.String })),
        ),
      }),
    ),
  }),
});

const BlueskyImages = Schema.Struct({
  images: Schema.Array(Schema.Struct({ fullsize: Schema.String })),
});

const BlueskyThread = Schema.Struct({
  thread: Schema.Struct({
    post: Schema.Struct({
      uri: Schema.String,
      author: Schema.Struct({
        did: Schema.String,
        handle: Schema.String,
        displayName: Schema.optionalKey(Schema.String),
        avatar: Schema.optionalKey(Schema.String),
      }),
      record: Schema.Struct({ text: Schema.String, createdAt: Schema.String }),
      embed: Schema.optionalKey(
        Schema.Struct({
          $type: Schema.String,
          images: Schema.optionalKey(BlueskyImages.fields.images),
          thumbnail: Schema.optionalKey(Schema.String),
          media: Schema.optionalKey(
            Schema.Struct({
              images: Schema.optionalKey(BlueskyImages.fields.images),
              thumbnail: Schema.optionalKey(Schema.String),
            }),
          ),
        }),
      ),
    }),
  }),
});

/** Plain text, trimmed, line endings as \n. */
const plain = (text: string): string => text.replace(/\r\n?/g, "\n").trim();

/** The post X serves as `json`, as stored. */
export function fromFxTweet(
  ref: Extract<PostRef, { platform: "x" }>,
  json: typeof FxTweet.Type,
): ResolvedPost {
  const { tweet } = json;
  const image =
    tweet.media?.photos?.[0]?.url ??
    tweet.media?.videos?.[0]?.thumbnail_url ??
    null;
  return {
    platform: "x",
    url: canonicalUrl(ref),
    authorName: tweet.author.name.trim() || tweet.author.screen_name,
    authorHandle: tweet.author.screen_name,
    authorUrl: `https://x.com/${tweet.author.screen_name}`,
    authorAvatarSourceUrl: tweet.author.avatar_url,
    postedAt: DateTime.makeUnsafe(tweet.created_timestamp * 1000),
    text: plain(tweet.text),
    imageSourceUrl: image,
  };
}

/** The post Bluesky's AppView serves as `json`, as stored. */
export function fromBlueskyThread(
  ref: Extract<PostRef, { platform: "bluesky" }>,
  json: typeof BlueskyThread.Type,
): ResolvedPost {
  const { post } = json.thread;
  const embed = post.embed;
  const image =
    embed?.images?.[0]?.fullsize ??
    embed?.media?.images?.[0]?.fullsize ??
    embed?.thumbnail ??
    embed?.media?.thumbnail ??
    null;
  return {
    platform: "bluesky",
    url: canonicalUrl(ref, post.author.did),
    authorName: post.author.displayName?.trim() || post.author.handle,
    authorHandle: post.author.handle,
    authorUrl: `https://bsky.app/profile/${post.author.handle}`,
    authorAvatarSourceUrl: post.author.avatar ?? null,
    postedAt: DateTime.makeUnsafe(post.record.createdAt),
    text: plain(post.record.text),
    imageSourceUrl: image,
  };
}

/** A LinkedIn post, from what a person gave for it. */
export function fromManual(
  ref: Extract<PostRef, { platform: "linkedin" }>,
  manual: ManualPost,
): ResolvedPost {
  return {
    platform: "linkedin",
    url: canonicalUrl(ref),
    authorName: manual.authorName.trim(),
    authorHandle: null,
    authorUrl: manual.authorUrl,
    authorAvatarSourceUrl: null,
    postedAt: linkedinPostedAt(ref.id),
    text: plain(manual.text),
    imageSourceUrl: null,
  };
}

export interface PostSourcesShape {
  /**
   * The post at `url`, read from its platform. A LinkedIn post needs
   * `manual`; for X and Bluesky it is ignored.
   */
  readonly resolve: (
    url: string,
    manual?: ManualPost,
  ) => Effect.Effect<ResolvedPost, PostSourceError>;
}

const retryable = (status: number) => status === 429 || status >= 500;

const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;

  const getJson = <S extends Schema.Top>(
    url: string,
    request: HttpClientRequest.HttpClientRequest,
    schema: S,
  ) => {
    const unanswered = () =>
      Effect.fail(
        new PostSourceError({ url, reason: "no answer", retryable: true }),
      );
    return Effect.gen(function* () {
      const response = yield* client.execute(request);
      if (response.status !== 200) {
        return yield* new PostSourceError({
          url,
          reason: `${request.url} answered ${response.status}`,
          retryable: retryable(response.status),
        });
      }
      const body = yield* response.json;
      return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
        Effect.mapError(
          () =>
            new PostSourceError({
              url,
              reason: "the answer is not a post as expected",
            }),
        ),
      );
    }).pipe(
      Effect.timeout(Duration.seconds(15)),
      Effect.catchTags({
        HttpClientError: unanswered,
        TimeoutError: unanswered,
      }),
      Effect.retry({
        schedule: Schedule.exponential(Duration.seconds(1)),
        times: 2,
        while: (error) => error.retryable === true,
      }),
    );
  };

  const resolve = (url: string, manual?: ManualPost) =>
    Effect.gen(function* () {
      const ref = parsePostUrl(url);
      if (ref === null) {
        return yield* new PostSourceError({
          url,
          reason: "not an X, Bluesky or LinkedIn post URL",
        });
      }
      if (ref.platform === "x") {
        const json = yield* getJson(
          url,
          HttpClientRequest.get(
            `https://api.fxtwitter.com/status/${ref.statusId}`,
          ).pipe(HttpClientRequest.acceptJson),
          FxTweet,
        );
        if (json.code !== 200 || json.tweet.id !== ref.statusId) {
          return yield* new PostSourceError({
            url,
            reason: `FixTweet served post ${json.tweet.id} (code ${json.code})`,
          });
        }
        return fromFxTweet(ref, json);
      }
      if (ref.platform === "bluesky") {
        const json = yield* getJson(
          url,
          HttpClientRequest.get(
            "https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread",
          ).pipe(
            HttpClientRequest.setUrlParams({
              uri: `at://${ref.actor}/app.bsky.feed.post/${ref.rkey}`,
              depth: "0",
              parentHeight: "0",
            }),
            HttpClientRequest.acceptJson,
          ),
          BlueskyThread,
        );
        if (!json.thread.post.uri.endsWith(`/app.bsky.feed.post/${ref.rkey}`)) {
          return yield* new PostSourceError({
            url,
            reason: `Bluesky served ${json.thread.post.uri}`,
          });
        }
        return fromBlueskyThread(ref, json);
      }
      if (
        manual === undefined ||
        manual.authorName.trim() === "" ||
        manual.text.trim() === ""
      ) {
        return yield* new PostSourceError({
          url,
          reason:
            "LinkedIn serves no public post data: give the author's name and the post's text",
        });
      }
      return fromManual(ref, manual);
    }).pipe(Effect.withSpan("PostSources.resolve", { attributes: { url } }));

  return PostSources.of({ resolve });
});

export class PostSources extends Context.Service<
  PostSources,
  PostSourcesShape
>()("allthings/PostSources") {
  /** Needs an `HttpClient`. */
  static readonly layer = Layer.effect(PostSources, make);
}
