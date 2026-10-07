import { Context, DateTime, Effect, Layer, Option } from "effect";
import { approvalToken } from "../approval.ts";
import type { DataSourceError } from "../errors.ts";
import { type Moment } from "../promo/drafts.ts";
import { DraftTooLong } from "../promo/limits.ts";
import { Promo } from "../promo/promo.ts";
import { PostRefused } from "./announce.ts";
import {
  Discord,
  type DiscordRefused,
  type DiscordUnanswered,
  type MessageContent,
  messageUrl,
  type Webhook,
} from "./discord.ts";
import { isUnsettled, type SentPost, SentPosts } from "./sent-posts.ts";

/**
 * Sending an evening's Discord draft (src/promo/) to our server through its
 * channel webhook, exactly as an organizer approved it:
 *
 * - `prepare` reads only: the draft's message for the moment, where the
 *   webhook posts, whether it was already sent (planning.sent_posts, since
 *   a webhook can't read the channel), and its approval token, the SHA-256
 *   of the webhook, its channel, the evening, the moment and the message.
 * - `send` takes the token, makes the message again, and goes on only if
 *   it hashes the same and nothing was sent or started for that moment.
 *   It claims the moment, sends once, and records the message. A refusal
 *   drops the claim. No answer keeps it, so nothing is sent twice.
 * - An unanswered send waits on an organizer who has looked at the
 *   channel: `recordSent` when the message is there (the webhook reads it
 *   back by id, and it must hash to the approved token, even if the draft
 *   has changed since), `release` when it isn't, so it can be approved
 *   again.
 */

/** The site's origin and the photo origin the drafts link to and count from. */
const siteOrigin = "https://allthings.dev";
const photoOrigin = "https://media.allthings.dev";

const refuse = (reason: string) => Effect.fail(new PostRefused({ reason }));

/** What would go out, as an organizer reads it before approving it. */
export interface PreparedMessage {
  readonly channel: "discord";
  readonly webhook: Webhook;
  readonly slug: string;
  readonly moment: Moment;
  readonly message: MessageContent;
  /** The moment's record: claimed or sent, or null when nothing was. */
  readonly sent: SentPost | null;
  readonly token: string;
}

type Failure = PostRefused | DataSourceError;

export interface DiscordAnnounceShape {
  readonly prepare: (
    slug: string,
    moment: Moment,
  ) => Effect.Effect<PreparedMessage, Failure>;
  readonly send: (
    slug: string,
    moment: Moment,
    token: string,
  ) => Effect.Effect<
    PreparedMessage & { readonly messageId: string; readonly url: string },
    Failure
  >;
  /** Records the message an organizer found in the channel as the one sent. */
  readonly recordSent: (
    slug: string,
    moment: Moment,
    messageId: string,
  ) => Effect.Effect<SentPost, Failure>;
  /** Lets go of an unsettled send an organizer saw isn't in the channel. */
  readonly release: (
    slug: string,
    moment: Moment,
  ) => Effect.Effect<SentPost, Failure>;
}

const command = (slug: string, moment: Moment, rest: string) =>
  `bun run social discord ${slug} --moment ${moment} ${rest}`;

const settleHint = (slug: string, moment: Moment) =>
  `Look in the channel: if it's there, record it with ${command(slug, moment, "--sent <message id>")}; if it isn't, let go of it with ${command(slug, moment, "--release")}, then approve it again.`;

const make = Effect.gen(function* () {
  const promo = yield* Promo;
  const discord = yield* Discord;
  const sentPosts = yield* SentPosts;

  const fromDiscord = (error: DiscordRefused | DiscordUnanswered) =>
    refuse(error.reason);

  /** Why `record` stops another send, or another settling. */
  const held = (record: SentPost, slug: string, moment: Moment) =>
    Effect.map(DateTime.now, (now) =>
      record.status === "sent"
        ? `Already sent: ${record.url ?? record.messageId ?? "(no page)"}`
        : isUnsettled(record, now)
          ? `A send of this message started at ${record.claimedAt} and was never answered, so it may be in the channel. ${settleHint(slug, moment)}`
          : `A send of this message started at ${record.claimedAt} and is still going: wait for it, then read it again with --dry-run.`,
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
      const message: MessageContent = {
        content: drafts.social.discord[moment],
        allowed_mentions: { parse: [] },
      };
      const webhook = yield* discord.webhook.pipe(
        Effect.catchTag(["DiscordRefused", "DiscordUnanswered"], fromDiscord),
      );
      const sent = yield* sentPosts.find("discord", slug, moment);
      const token = yield* approvalToken({
        channel: "discord",
        webhook: webhook.id,
        channelId: webhook.channelId,
        slug,
        moment,
        message,
      });
      return {
        channel: "discord" as const,
        webhook,
        slug,
        moment,
        message,
        sent: Option.getOrNull(sent),
        token,
      } satisfies PreparedMessage;
    });

  const send = (slug: string, moment: Moment, token: string) =>
    Effect.gen(function* () {
      const prepared = yield* prepare(slug, moment);
      if (prepared.token !== token) {
        return yield* refuse(
          `What would be sent has changed since ${token} was approved: it is now ${prepared.token}. Read it again with --dry-run, and approve that.`,
        );
      }
      if (prepared.sent !== null) {
        return yield* refuse(yield* held(prepared.sent, slug, moment));
      }
      const claim = yield* sentPosts.claim(
        "discord",
        slug,
        moment,
        token,
        prepared.message.content,
      );
      if (Option.isNone(claim)) {
        const record = yield* sentPosts.find("discord", slug, moment);
        return yield* refuse(
          Option.isSome(record)
            ? yield* held(record.value, slug, moment)
            : `No evening has the slug "${slug}".`,
        );
      }
      // Fenced: a claim let go of while this stalled is not sent on.
      if (!(yield* sentPosts.hold(claim.value.id))) {
        return yield* refuse(
          "The claim on this send was let go of before it went out: nothing was sent. Read it again with --dry-run.",
        );
      }
      const { id } = yield* discord.send(prepared.message).pipe(
        Effect.catchTag("DiscordRefused", (error) =>
          Effect.andThen(sentPosts.drop(claim.value.id), () =>
            refuse(`${error.reason}: nothing was sent.`),
          ),
        ),
        Effect.catchTag("DiscordUnanswered", (error) =>
          Effect.andThen(sentPosts.markUnanswered(claim.value.id), () =>
            refuse(
              `${error.reason}, so the message may be in the channel. ${settleHint(slug, moment)}`,
            ),
          ),
        ),
      );
      const url = messageUrl(prepared.webhook, id);
      const record = yield* sentPosts.markSent(claim.value.id, id, url);
      return { ...prepared, sent: record, messageId: id, url };
    });

  /** The moment's record, if an organizer may settle it now. */
  const unsettled = (slug: string, moment: Moment) =>
    Effect.gen(function* () {
      const record = yield* sentPosts.find("discord", slug, moment);
      if (Option.isNone(record)) {
        return yield* refuse(
          `Nothing was started for ${slug}'s ${moment} message: there is nothing to settle.`,
        );
      }
      const now = yield* DateTime.now;
      if (!isUnsettled(record.value, now)) {
        return yield* refuse(yield* held(record.value, slug, moment));
      }
      return record.value;
    });

  const recordSent = (slug: string, moment: Moment, messageId: string) =>
    Effect.gen(function* () {
      const record = yield* unsettled(slug, moment);
      const webhook = yield* discord.webhook.pipe(
        Effect.catchTag(["DiscordRefused", "DiscordUnanswered"], fromDiscord),
      );
      const found = yield* discord
        .sentMessage(messageId)
        .pipe(
          Effect.catchTag(["DiscordRefused", "DiscordUnanswered"], fromDiscord),
        );
      if (Option.isNone(found)) {
        return yield* refuse(
          `The webhook sent no message ${messageId}: copy the id from the message in the channel (Copy Message ID).`,
        );
      }
      // What was approved hashes to the claim's token, whatever the draft says now.
      const token = yield* approvalToken({
        channel: "discord",
        webhook: webhook.id,
        channelId: webhook.channelId,
        slug,
        moment,
        message: {
          content: found.value.content,
          allowed_mentions: { parse: [] },
        } satisfies MessageContent,
      });
      if (token !== record.token) {
        return yield* refuse(
          `Message ${messageId} doesn't say what was approved (${record.token}), so it isn't this send: nothing was recorded.`,
        );
      }
      return yield* sentPosts.markSent(
        record.id,
        found.value.id,
        messageUrl(webhook, found.value.id),
      );
    });

  const release = (slug: string, moment: Moment) =>
    Effect.gen(function* () {
      const record = yield* unsettled(slug, moment);
      const released = yield* sentPosts.release(record.id);
      if (Option.isSome(released)) return released.value;
      return yield* refuse(
        "The send was settled while this ran: read it again with --dry-run.",
      );
    });

  return DiscordAnnounce.of({ prepare, send, recordSent, release });
});

export class DiscordAnnounce extends Context.Service<
  DiscordAnnounce,
  DiscordAnnounceShape
>()("allthings/DiscordAnnounce") {
  /** Needs `Promo`, `Discord` and `SentPosts`. */
  static readonly layer = Layer.effect(DiscordAnnounce, make);
}
