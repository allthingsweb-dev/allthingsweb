import { Context, DateTime, Effect, Layer, Option, Redacted } from "effect";
import { approvalToken } from "../approval.ts";
import type { DataSourceError } from "../errors.ts";
import { type Moment } from "../promo/drafts.ts";
import { DraftTooLong } from "../promo/limits.ts";
import { Promo } from "../promo/promo.ts";
import { PostRefused } from "./announce.ts";
import { isUnsettled, type SentPost, SentPosts } from "./sent-posts.ts";
import { sameText, X, type XUnavailable, xPostUrl } from "./x.ts";
import { type SignInUnavailable, XSignIn } from "./x-sign-in.ts";

/**
 * Posting an evening's X draft (src/promo/) as @allthingswebdev, exactly as
 * an organizer approved it. Which posts went out is kept in
 * planning.sent_posts, as for Discord, rather than read from X:
 *
 * - `prepare` reads only, and nothing from X. It gives the draft's text
 *   for the moment, the moment's record (claimed, unanswered or sent), and
 *   its approval token: the SHA-256 of the account, the evening, the
 *   moment and the text.
 * - `post` takes the token, makes the post again, and goes on only if it
 *   hashes the same and nothing was sent or started for that moment. It
 *   claims the moment with the exact text, then:
 *   1. signs in with the stored refresh token;
 *   2. stores the new one X hands back before anything else;
 *   3. checks the sign-in is our account;
 *   4. renews the claim and posts once.
 *   Anything that stops it before the post drops the claim, as does X
 *   refusing the post. No answer, or a 5xx, marks it unanswered, so
 *   nothing is posted twice.
 * - An unanswered post waits on an organizer who has looked at our
 *   profile. `recordSent` takes the post they found there, once X reads it
 *   back as ours and saying the text that was approved (links aside: X
 *   shows them as t.co). `release` takes the word that there is none, so it
 *   can be approved again.
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
  /** The moment's record: claimed or sent, or null when nothing was. */
  readonly sent: SentPost | null;
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
  /** Records the post an organizer found on our profile as the one sent. */
  readonly recordSent: (
    slug: string,
    moment: Moment,
    postId: string,
  ) => Effect.Effect<SentPost, Failure>;
  /** Lets go of an unsettled post an organizer saw isn't on our profile. */
  readonly release: (
    slug: string,
    moment: Moment,
  ) => Effect.Effect<SentPost, Failure>;
}

const command = (slug: string, moment: Moment, rest: string) =>
  `bun run social x ${slug} --moment ${moment} ${rest}`;

const settleHint = (slug: string, moment: Moment) =>
  `Look at https://x.com/${ourXAccount.handle}: if it's there, record it with ${command(slug, moment, "--sent <post id>")} (the number at the end of its link); if it isn't, let go of it with ${command(slug, moment, "--release")}, then approve it again.`;

/** How to sign our account in again, after "sign" or "Sign". */
const inAgain = `@${ourXAccount.handle} in again (xurl auth oauth2 --app allthings ${ourXAccount.handle}), then bun run social x-sign-in --from-xurl`;

const make = Effect.gen(function* () {
  const promo = yield* Promo;
  const x = yield* X;
  const signIn = yield* XSignIn;
  const sentPosts = yield* SentPosts;

  const because = (error: XUnavailable | SignInUnavailable) =>
    refuse(error.reason);

  /** Why `record` stops another post, or another settling. */
  const held = (record: SentPost, slug: string, moment: Moment) =>
    Effect.map(DateTime.now, (now) =>
      record.status === "sent"
        ? `Already posted: ${record.url ?? record.messageId ?? "(no page)"}`
        : isUnsettled(record, now)
          ? `A post of this started at ${record.claimedAt} and was never answered, so it may be out. ${settleHint(slug, moment)}`
          : `A post of this started at ${record.claimedAt} and is still going: wait for it, then read it again with --dry-run.`,
    );

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
      const sent = yield* sentPosts.find("x", slug, moment);
      const token = yield* approvalToken({
        channel: "x",
        account: ourXAccount.id,
        slug,
        moment,
        text,
      });
      return {
        channel: "x" as const,
        account: ourXAccount,
        slug,
        moment,
        text,
        sent: Option.getOrNull(sent),
        token,
      } satisfies PreparedXPost;
    });

  const wrongAccount = (id: string, username: string) =>
    `The X sign-in is @${username} (${id}), not @${ourXAccount.handle} (${ourXAccount.id})`;

  /** Signs in as our account: an access token, the new refresh token kept. */
  const signedIn = Effect.gen(function* () {
    const stored = yield* signIn.read;
    if (Option.isNone(stored)) {
      return yield* refuse(
        "No X sign-in is stored: run bun run social x-sign-in --from-xurl first. Nothing was posted.",
      );
    }
    const tokens = yield* x
      .refresh(stored.value)
      .pipe(
        Effect.catchTag("XUnavailable", (error) =>
          refuse(
            `${error.reason}, so nothing was posted. X may have spent the stored sign-in anyway: if the next try is refused too, sign ${inAgain}.`,
          ),
        ),
      );
    // X has spent the stored token: keep the new one before anything else.
    yield* signIn
      .write(tokens.refresh)
      .pipe(
        Effect.catchTag("SignInUnavailable", (error) =>
          refuse(
            `${error.reason}. X has spent the stored sign-in and its new one wasn't kept, so nothing was posted. Sign ${inAgain}.`,
          ),
        ),
      );
    const me = yield* x.me(tokens.access);
    if (me.id !== ourXAccount.id) {
      return yield* refuse(
        `${wrongAccount(me.id, me.username)}: nothing was posted.`,
      );
    }
    return tokens.access;
  }).pipe(Effect.catchTag(["XUnavailable", "SignInUnavailable"], because));

  const post = (slug: string, moment: Moment, token: string) =>
    Effect.gen(function* () {
      const prepared = yield* prepare(slug, moment);
      if (prepared.token !== token) {
        return yield* refuse(
          `What would be posted has changed since ${token} was approved: it is now ${prepared.token}. Read it again with --dry-run, and approve that.`,
        );
      }
      if (prepared.sent !== null) {
        return yield* refuse(yield* held(prepared.sent, slug, moment));
      }
      const claim = yield* sentPosts.claim(
        "x",
        slug,
        moment,
        token,
        prepared.text,
      );
      if (Option.isNone(claim)) {
        const record = yield* sentPosts.find("x", slug, moment);
        return yield* refuse(
          Option.isSome(record)
            ? yield* held(record.value, slug, moment)
            : `No evening has the slug "${slug}".`,
        );
      }
      const id = claim.value.id;
      /**
       * Refuses with `said` once `update` has settled the claim; if the
       * record can't take `update`, the claim counts as abandoned five
       * minutes after it started, and `then` says what to do at that point.
       */
      const afterwards = (
        update: Effect.Effect<void, DataSourceError>,
        said: string,
        then: string,
      ) =>
        update.pipe(
          Effect.matchEffect({
            onSuccess: () => refuse(said),
            onFailure: () =>
              refuse(
                `${said} The record couldn't take that, so the claim still says it's going: five minutes after it started, ${then}`,
              ),
          }),
        );
      const releaseIt = `let go of it with ${command(slug, moment, "--release")}.`;
      // Nothing has been posted yet: a sign-in that fails lets go of the claim.
      const access = yield* signedIn.pipe(
        Effect.catchTag("PostRefused", (refusal) =>
          afterwards(sentPosts.drop(id), refusal.reason, releaseIt),
        ),
      );
      // Fenced: a claim let go of while this stalled is not posted on.
      if (!(yield* sentPosts.hold(id))) {
        return yield* refuse(
          "The claim on this post was let go of before it went out: nothing was posted. Read it again with --dry-run.",
        );
      }
      const created = yield* x
        .post(access, prepared.text)
        .pipe(
          Effect.catchTag("XUnavailable", (error) =>
            error.outcome === "refused"
              ? afterwards(
                  sentPosts.drop(id),
                  `${error.reason}: nothing was posted.`,
                  releaseIt,
                )
              : afterwards(
                  sentPosts.markUnanswered(id),
                  `${error.reason}, so it may be out. ${settleHint(slug, moment)}`,
                  "settle it as above.",
                ),
          ),
        );
      const url = xPostUrl(ourXAccount.handle, created.id);
      const record = yield* sentPosts
        .markSent(id, created.id, url)
        .pipe(
          Effect.catchTag("DataSourceError", () =>
            refuse(
              `Posted as ${url}, but the record didn't take it, so the claim still says it's going. Five minutes after it started, record it with ${command(slug, moment, `--sent ${created.id}`)}.`,
            ),
          ),
        );
      if (Option.isNone(record)) {
        return yield* refuse(
          `Posted as ${url}, but its claim was let go of while it went out, so nothing records it: don't approve it again.`,
        );
      }
      return { ...prepared, id: created.id, url };
    });

  /** The moment's record, if an organizer may settle it now. */
  const unsettled = (slug: string, moment: Moment) =>
    Effect.gen(function* () {
      const record = yield* sentPosts.find("x", slug, moment);
      if (Option.isNone(record)) {
        return yield* refuse(
          `Nothing was started for ${slug}'s ${moment} post: there is nothing to settle.`,
        );
      }
      const now = yield* DateTime.now;
      if (!isUnsettled(record.value, now)) {
        return yield* refuse(yield* held(record.value, slug, moment));
      }
      return record.value;
    });

  const recordSent = (slug: string, moment: Moment, postId: string) =>
    Effect.gen(function* () {
      const record = yield* unsettled(slug, moment);
      const found = yield* x
        .lookup(postId)
        .pipe(Effect.catchTag("XUnavailable", because));
      if (Option.isNone(found)) {
        return yield* refuse(
          `X has no post ${postId}: copy the number at the end of the post's link on x.com.`,
        );
      }
      if (found.value.authorId !== ourXAccount.id) {
        return yield* refuse(
          `Post ${postId} isn't @${ourXAccount.handle}'s: nothing was recorded.`,
        );
      }
      if (record.body === null || !sameText(found.value.text, record.body)) {
        return yield* refuse(
          `Post ${postId} doesn't say what was approved (${record.token}), so it isn't this post: nothing was recorded.`,
        );
      }
      const sent = yield* sentPosts.markSent(
        record.id,
        found.value.id,
        xPostUrl(ourXAccount.handle, found.value.id),
      );
      if (Option.isNone(sent)) {
        return yield* refuse(
          "The claim was let go of while this ran: nothing was recorded. Read it again with --dry-run.",
        );
      }
      return sent.value;
    });

  const release = (slug: string, moment: Moment) =>
    Effect.gen(function* () {
      const record = yield* unsettled(slug, moment);
      const released = yield* sentPosts.release(record.id);
      if (Option.isSome(released)) return released.value;
      return yield* refuse(
        "The post was settled while this ran: read it again with --dry-run.",
      );
    });

  return XAnnounce.of({ prepare, post, recordSent, release });
});

export class XAnnounce extends Context.Service<XAnnounce, XAnnounceShape>()(
  "allthings/XAnnounce",
) {
  /** Needs `Promo`, `X`, `XSignIn` and `SentPosts`. */
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
