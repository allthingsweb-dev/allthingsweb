import { Context, Effect, Layer, Option, Redacted } from "effect";
import { approvalToken } from "../approval.ts";
import type { DataSourceError } from "../errors.ts";
import { type Moment } from "../promo/drafts.ts";
import { DraftTooLong } from "../promo/limits.ts";
import { Promo } from "../promo/promo.ts";
import { PostRefused } from "./announce.ts";
import { sameText, X, type XUnavailable, xPostUrl } from "./x.ts";
import { type SignInUnavailable, XSignIn } from "./x-sign-in.ts";

/**
 * Posting an evening's X draft (src/promo/) as @allthingswebdev, exactly as
 * an organizer approved it:
 *
 * - `prepare` reads only, with the app's bearer token: the draft's text for
 *   the moment, whether our account already posted it (its last ten posts),
 *   and its approval token, the SHA-256 of the account, the evening, the
 *   moment and the text. It needs no sign-in, and spends none.
 * - `post` takes the token, makes the post again, and goes on only if it
 *   hashes the same and our account hasn't posted that text. Then it signs
 *   in with the stored refresh token, stores the new one X hands back
 *   before anything else, checks the sign-in is our account, and posts
 *   once.
 *
 * `adoptSignIn` stores a sign-in made elsewhere (xurl's) as the one to use.
 */

/** Our account: @allthingswebdev. */
export const ourXAccount = {
  handle: "allthingswebdev",
  id: "1791650356667224064",
} as const;

/** The site's origin and the photo origin the drafts link to and count from. */
const siteOrigin = "https://allthings.dev";
const photoOrigin = "https://media.allthings.dev";

const refuse = (reason: string) => Effect.fail(new PostRefused({ reason }));

/** What would go out, as an organizer reads it before approving it. */
export interface PreparedXPost {
  readonly channel: "x";
  readonly account: typeof ourXAccount;
  readonly slug: string;
  readonly moment: Moment;
  readonly text: string;
  /** The page of a post of ours with this text, if there is one. */
  readonly alreadyPosted: string | null;
  readonly token: string;
}

type Failure = PostRefused | DataSourceError;

export interface XAnnounceShape {
  readonly prepare: (
    slug: string,
    moment: Moment,
  ) => Effect.Effect<PreparedXPost, Failure>;
  readonly post: (
    slug: string,
    moment: Moment,
    token: string,
  ) => Effect.Effect<
    PreparedXPost & { readonly id: string; readonly url: string },
    Failure
  >;
}

const make = Effect.gen(function* () {
  const promo = yield* Promo;
  const x = yield* X;
  const signIn = yield* XSignIn;

  const because = (error: XUnavailable | SignInUnavailable) =>
    refuse(error.reason);

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
      const text = drafts.social.x[moment];
      const recent = yield* x
        .recentPosts(ourXAccount.id)
        .pipe(Effect.catchTag("XUnavailable", because));
      const token = yield* approvalToken({
        channel: "x",
        account: ourXAccount.id,
        slug,
        moment,
        text,
      });
      const posted = recent.find((post) => sameText(post.text, text));
      return {
        channel: "x" as const,
        account: ourXAccount,
        slug,
        moment,
        text,
        alreadyPosted:
          posted === undefined ? null : xPostUrl(ourXAccount.handle, posted.id),
        token,
      } satisfies PreparedXPost;
    });

  const wrongAccount = (id: string, username: string) =>
    `The X sign-in is @${username} (${id}), not @${ourXAccount.handle} (${ourXAccount.id})`;

  const post = (slug: string, moment: Moment, token: string) =>
    Effect.gen(function* () {
      const prepared = yield* prepare(slug, moment);
      if (prepared.token !== token) {
        return yield* refuse(
          `What would be posted has changed since ${token} was approved: it is now ${prepared.token}. Read it again with --dry-run, and approve that.`,
        );
      }
      if (prepared.alreadyPosted !== null) {
        return yield* refuse(`Already posted: ${prepared.alreadyPosted}`);
      }
      const stored = yield* signIn.read;
      if (Option.isNone(stored)) {
        return yield* refuse(
          "No X sign-in is stored: run bun run social x-sign-in --from-xurl first. Nothing was posted.",
        );
      }
      const tokens = yield* x.refresh(stored.value);
      // X has spent the stored token: keep the new one before anything else.
      yield* signIn
        .write(tokens.refresh)
        .pipe(
          Effect.catchTag("SignInUnavailable", (error) =>
            refuse(
              `${error.reason}. X has spent the stored sign-in and its new one wasn't kept, so nothing was posted. Sign @${ourXAccount.handle} in again (xurl auth oauth2), then bun run social x-sign-in --from-xurl.`,
            ),
          ),
        );
      const me = yield* x.me(tokens.access);
      if (me.id !== ourXAccount.id) {
        return yield* refuse(
          `${wrongAccount(me.id, me.username)}: nothing was posted.`,
        );
      }
      const { id } = yield* x
        .post(tokens.access, prepared.text)
        .pipe(
          Effect.catchTag("XUnavailable", (error) =>
            refuse(
              `${error.reason}. It may still have gone out: read it again with --dry-run, which says if it did, before approving it again.`,
            ),
          ),
        );
      return { ...prepared, id, url: xPostUrl(ourXAccount.handle, id) };
    }).pipe(Effect.catchTag(["XUnavailable", "SignInUnavailable"], because));

  return XAnnounce.of({ prepare, post });
});

export class XAnnounce extends Context.Service<XAnnounce, XAnnounceShape>()(
  "allthings/XAnnounce",
) {
  /** Needs `Promo`, `X` and `XSignIn`. */
  static readonly layer = Layer.effect(XAnnounce, make);
}

/**
 * Stores `made`'s refresh token as the sign-in to use. While its access
 * token is unexpired, it must sign in as our account (`verified`);
 * otherwise the first post checks that.
 */
export const adoptSignIn = (made: {
  readonly access: Redacted.Redacted;
  readonly refresh: Redacted.Redacted;
  readonly expiresAt: number;
}) =>
  Effect.gen(function* () {
    const x = yield* X;
    const signIn = yield* XSignIn;
    const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
    const verified = made.expiresAt > now;
    if (verified) {
      const me = yield* x.me(made.access);
      if (me.id !== ourXAccount.id) {
        return yield* refuse(
          `The X sign-in is @${me.username} (${me.id}), not @${ourXAccount.handle} (${ourXAccount.id}): nothing was stored.`,
        );
      }
    }
    yield* signIn.write(made.refresh);
    return { verified };
  }).pipe(
    Effect.catchTag(["XUnavailable", "SignInUnavailable"], (error) =>
      refuse(error.reason),
    ),
  );
