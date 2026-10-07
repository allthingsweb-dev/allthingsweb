import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { approvalToken } from "../approval.ts";
import type { DataSourceError } from "../errors.ts";
import { type Moment } from "../promo/drafts.ts";
import { DraftTooLong } from "../promo/limits.ts";
import { Promo } from "../promo/promo.ts";
import {
  Bluesky,
  type BlueskyUnavailable,
  facetsOf,
  type PostContent,
  postUrl,
  spansOf,
} from "./bluesky.ts";
import { ourAccount } from "./account.ts";

/**
 * Posting an evening's promotion draft (src/promo/) to Bluesky, from our
 * account, exactly as an organizer approved it:
 *
 * - `prepare` makes the post: the draft's text for the moment (announce,
 *   on the day, the recap), with a facet for every link and for every
 *   mention whose handle Bluesky resolves, and its approval token, the
 *   SHA-256 of the account, the evening, the moment and the post. It also
 *   says whether the account already posted that text.
 * - `post` takes the token, makes the post again, and goes on only if it
 *   hashes the same, the account hasn't posted that text, and the app
 *   password signs in as our account. Then it posts once.
 *
 * Nothing posts without a token, and a token is good for one text only.
 */

export { ourAccount };

/** The site's origin and the photo origin the drafts link to and count from. */
const siteOrigin = "https://allthings.dev";
const photoOrigin = "https://media.allthings.dev";

export class PostRefused extends Schema.TaggedError<PostRefused>()(
  "PostRefused",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

const refuse = (reason: string) => Effect.fail(new PostRefused({ reason }));

/** What would go out, as an organizer reads it before approving it. */
export interface PreparedPost {
  readonly channel: "bluesky";
  readonly account: typeof ourAccount;
  readonly slug: string;
  readonly moment: Moment;
  readonly content: PostContent;
  /** Mentions that stay plain text: Bluesky resolves no account for them. */
  readonly unresolved: ReadonlyArray<string>;
  /** The URI of a post of ours with exactly this text, if there is one. */
  readonly alreadyPosted: string | null;
  readonly token: string;
}

type Failure = PostRefused | BlueskyUnavailable | DataSourceError;

export interface AnnounceShape {
  readonly prepare: (
    slug: string,
    moment: Moment,
  ) => Effect.Effect<PreparedPost, Failure>;
  readonly post: (
    slug: string,
    moment: Moment,
    token: string,
  ) => Effect.Effect<
    PreparedPost & { readonly uri: string; readonly url: string },
    Failure
  >;
}

const make = Effect.gen(function* () {
  const promo = yield* Promo;
  const bluesky = yield* Bluesky;

  const prepare = (slug: string, moment: Moment) =>
    Effect.gen(function* () {
      const drafts = yield* promo
        .drafts(slug, { origin: siteOrigin, photoOrigin })
        .pipe(
          Effect.catchTag("EventNotFound", () =>
            refuse(`No published evening has the slug "${slug}".`),
          ),
          Effect.catchIf(
            (error): error is DraftTooLong => error instanceof DraftTooLong,
            (error) => refuse(error.message),
          ),
        );
      const text = drafts.social.bluesky[moment];
      const handles = [
        ...new Set(
          spansOf(text)
            .filter((span) => span.kind === "mention")
            .map((span) => span.value),
        ),
      ];
      const resolved = yield* Effect.forEach(handles, (handle) =>
        Effect.map(
          bluesky.resolveHandle(handle),
          (did) => [handle, did] as const,
        ),
      );
      const dids = new Map(
        resolved.flatMap(([handle, did]) =>
          Option.isSome(did) ? [[handle, did.value] as const] : [],
        ),
      );
      const content: PostContent = {
        text,
        facets: facetsOf(text, dids),
        langs: ["en"],
      };
      const recent = yield* bluesky.recentPosts(ourAccount.did);
      const token = yield* approvalToken({
        channel: "bluesky",
        account: ourAccount.did,
        slug,
        moment,
        content,
      });
      return {
        channel: "bluesky" as const,
        account: ourAccount,
        slug,
        moment,
        content,
        unresolved: handles.filter((handle) => !dids.has(handle)),
        alreadyPosted: recent.find((post) => post.text === text)?.uri ?? null,
        token,
      } satisfies PreparedPost;
    });

  const post = (slug: string, moment: Moment, token: string) =>
    Effect.gen(function* () {
      const prepared = yield* prepare(slug, moment);
      if (prepared.token !== token) {
        return yield* refuse(
          `What would be posted has changed since ${token} was approved: it is now ${prepared.token}. Read it again with --dry-run, and approve that.`,
        );
      }
      if (prepared.alreadyPosted !== null) {
        return yield* refuse(
          `Already posted: ${postUrl(ourAccount.handle, prepared.alreadyPosted)}`,
        );
      }
      const signedIn = yield* bluesky.account;
      if (signedIn.did !== ourAccount.did) {
        return yield* refuse(
          `The app password signs in as ${signedIn.did}, not @${ourAccount.handle} (${ourAccount.did}): nothing was posted.`,
        );
      }
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      const { uri } = yield* bluesky.post(prepared.content, createdAt);
      return { ...prepared, uri, url: postUrl(ourAccount.handle, uri) };
    });

  return Announce.of({ prepare, post });
});

export class Announce extends Context.Service<Announce, AnnounceShape>()(
  "allthings/Announce",
) {
  /** Needs `Promo` and `Bluesky`. */
  static readonly layer = Layer.effect(Announce, make);
}
