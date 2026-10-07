import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as Database from "../src/database.ts";
import { moments } from "../src/promo/drafts.ts";
import { Promo } from "../src/promo/promo.ts";
import {
  Announce,
  type PreparedPost,
  PostRefused,
} from "../src/social/announce.ts";
import {
  DiscordAnnounce,
  type PreparedMessage,
} from "../src/social/announce-discord.ts";
import { Bluesky } from "../src/social/bluesky.ts";
import { Discord } from "../src/social/discord.ts";
import { SentPosts } from "../src/social/sent-posts.ts";

/**
 * Posts an evening's promotion draft (src/promo/) from our accounts, exactly
 * as approved (src/social/):
 *
 *   bun run social bluesky <slug> --moment announce --dry-run    the post, and its approval token
 *   bun run social bluesky <slug> --moment announce --approve <token>   post exactly that, once
 *   bun run social discord <slug> --moment dayOf --dry-run       the message, where it goes, its token
 *   bun run social discord <slug> --moment dayOf --approve <token>      send exactly that, once
 *   bun run social discord <slug> --moment dayOf --sent <id>     record the message an unanswered send left
 *   bun run social discord <slug> --moment dayOf --release       let go of an unanswered send that left none
 *
 * --dry-run reads only: for Bluesky, the draft, the handles it mentions,
 * and our recent posts; for Discord, the draft, the webhook, and the
 * record of what was sent (planning.sent_posts). DATABASE_URL,
 * BLUESKY_HANDLE, BLUESKY_APP_PASSWORD and DISCORD_WEBHOOK_URL come from
 * the environment only; .env files are not read. Bluesky's dry run needs
 * no password; Discord's record needs the database owner.
 */

const bluesky = Announce.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Promo.layer,
      Bluesky.layer.pipe(Layer.provide(FetchHttpClient.layer)),
    ),
  ),
  Layer.provide(Database.layer),
);

const discord = DiscordAnnounce.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Promo.layer,
      Discord.layer.pipe(Layer.provide(FetchHttpClient.layer)),
      SentPosts.layer,
    ),
  ),
  Layer.provide(Database.layer),
);

const describePost = (prepared: PreparedPost) =>
  [
    `Bluesky @${prepared.account.handle} · ${prepared.slug} · ${prepared.moment}`,
    "---",
    prepared.content.text,
    "---",
    `${prepared.content.facets.length} links and mentions${prepared.unresolved.length === 0 ? "" : `; plain text, no account found: ${prepared.unresolved.map((handle) => `@${handle}`).join(", ")}`}`,
    prepared.alreadyPosted === null
      ? "not posted yet"
      : `already posted: ${prepared.alreadyPosted}`,
    `approval token: ${prepared.token}`,
  ].join("\n");

const describeMessage = (prepared: PreparedMessage) =>
  [
    `Discord · webhook "${prepared.webhook.name}" · channel https://discord.com/channels/${prepared.webhook.guildId}/${prepared.webhook.channelId} · ${prepared.slug} · ${prepared.moment}`,
    "---",
    prepared.message.content,
    "---",
    "pings no one",
    prepared.sent === null
      ? "not sent yet"
      : prepared.sent.status === "sent"
        ? `already sent: ${prepared.sent.url ?? ""}`
        : `a send started at ${prepared.sent.claimedAt} isn't settled (${prepared.sent.status})`,
    `approval token: ${prepared.token}`,
  ].join("\n");

const slug = Argument.String("slug").pipe(
  Argument.withDescription("The published evening's slug."),
);
const moment = Flag.Literals("moment", moments).pipe(
  Flag.withDescription(`Which draft (${moments.join(", ")}).`),
);
const dryRun = Flag.Boolean("dry-run").pipe(
  Flag.withDescription("Print what would go out and its token; send nothing."),
  Flag.withDefault(false),
);
const approve = Flag.String("approve").pipe(
  Flag.withDescription("The token --dry-run printed: send exactly that."),
  Flag.optional,
);
const json = Flag.Boolean("json").pipe(
  Flag.withDescription("Print the result as JSON."),
  Flag.withDefault(false),
);

const blueskyCommand = Command.make(
  "bluesky",
  { slug, moment, dryRun, approve, json },
  (options) =>
    Effect.gen(function* () {
      if (options.dryRun === Option.isSome(options.approve)) {
        return yield* new PostRefused({
          reason:
            "Give --dry-run to read the post, or --approve <token> to post exactly that.",
        });
      }
      if (Option.isNone(options.approve)) {
        const prepared = yield* Announce.use((announce) =>
          announce.prepare(options.slug, options.moment),
        );
        return yield* Console.log(
          options.json
            ? JSON.stringify(prepared, null, 2)
            : `${describePost(prepared)}\nNothing was posted. To post exactly this: bun run social bluesky ${options.slug} --moment ${options.moment} --approve ${prepared.token}`,
        );
      }
      const token = options.approve.value;
      const posted = yield* Announce.use((announce) =>
        announce.post(options.slug, options.moment, token),
      );
      return yield* Console.log(
        options.json
          ? JSON.stringify(posted, null, 2)
          : `Posted: ${posted.url}\n${describePost(posted)}`,
      );
    }).pipe(Effect.provide(bluesky)),
).pipe(
  Command.withDescription(
    "Post an evening's Bluesky draft from @allthingsweb.dev, exactly as approved.",
  ),
);

const discordCommand = Command.make(
  "discord",
  {
    slug,
    moment,
    dryRun,
    approve,
    sent: Flag.String("sent").pipe(
      Flag.withDescription(
        "Record the message an unanswered send left in the channel, by its id.",
      ),
      Flag.optional,
    ),
    release: Flag.Boolean("release").pipe(
      Flag.withDescription(
        "Let go of an unanswered send, once you've seen it isn't in the channel.",
      ),
      Flag.withDefault(false),
    ),
    json,
  },
  (options) =>
    Effect.gen(function* () {
      const chosen = [
        options.dryRun,
        Option.isSome(options.approve),
        Option.isSome(options.sent),
        options.release,
      ].filter(Boolean).length;
      if (chosen !== 1) {
        return yield* new PostRefused({
          reason:
            "Give one of --dry-run to read the message, --approve <token> to send exactly that, or, for a send that went unanswered, --sent <message id> to record the message it left or --release to let go of it.",
        });
      }
      if (Option.isSome(options.sent)) {
        const messageId = options.sent.value;
        const recorded = yield* DiscordAnnounce.use((announce) =>
          announce.recordSent(options.slug, options.moment, messageId),
        );
        return yield* Console.log(
          options.json
            ? JSON.stringify(recorded, null, 2)
            : `Recorded as sent: ${recorded.url ?? messageId}. Nothing was sent.`,
        );
      }
      if (options.release) {
        const released = yield* DiscordAnnounce.use((announce) =>
          announce.release(options.slug, options.moment),
        );
        return yield* Console.log(
          options.json
            ? JSON.stringify(released, null, 2)
            : `Let go of the send started at ${released.claimedAt}. Nothing was sent; read it again with --dry-run to approve it.`,
        );
      }
      if (Option.isNone(options.approve)) {
        const prepared = yield* DiscordAnnounce.use((announce) =>
          announce.prepare(options.slug, options.moment),
        );
        return yield* Console.log(
          options.json
            ? JSON.stringify(prepared, null, 2)
            : `${describeMessage(prepared)}\nNothing was sent. To send exactly this: bun run social discord ${options.slug} --moment ${options.moment} --approve ${prepared.token}`,
        );
      }
      const token = options.approve.value;
      const sent = yield* DiscordAnnounce.use((announce) =>
        announce.send(options.slug, options.moment, token),
      );
      return yield* Console.log(
        options.json
          ? JSON.stringify(sent, null, 2)
          : `Sent: ${sent.url}\n${describeMessage(sent)}`,
      );
    }).pipe(Effect.provide(discord)),
).pipe(
  Command.withDescription(
    "Send an evening's Discord draft through our server's webhook, exactly as approved.",
  ),
);

const social = Command.make("social").pipe(
  Command.withDescription("Post an evening's drafts from our accounts."),
  Command.withSubcommands([blueskyCommand, discordCommand]),
);

// A refusal, or Bluesky not answering, is the answer, not a crash: its
// reason alone, on stderr, and exit 1.
Command.run(social, { version: "1.0.0" }).pipe(
  Effect.catchTag(["PostRefused", "BlueskyUnavailable"], (refusal) =>
    Effect.sync(() => {
      console.error(refusal.reason);
      process.exitCode = 1;
    }),
  ),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
