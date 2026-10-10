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
import {
  adoptSignIn,
  type PreparedXPost,
  XAnnounce,
} from "../src/social/announce-x.ts";
import { Bluesky } from "../src/social/bluesky.ts";
import { Discord } from "../src/social/discord.ts";
import { SentPosts } from "../src/social/sent-posts.ts";
import { X } from "../src/social/x.ts";
import { fromXurl, signInItem, XSignIn } from "../src/social/x-sign-in.ts";

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
 *   bun run social x <slug> --moment announce --dry-run          the post, and its approval token
 *   bun run social x <slug> --moment announce --approve <token>  post exactly that, once
 *   bun run social x <slug> --moment announce --sent <id>         record the post an unanswered post left
 *   bun run social x <slug> --moment announce --release           let go of an unanswered post that left none
 *   bun run social x-sign-in --from-xurl                          keep xurl's sign-in as ours
 *
 * --dry-run reads only: for Bluesky, the draft, the handles it mentions,
 * and our recent posts; for Discord, the draft, the webhook, and the
 * record of what was sent (planning.sent_posts); for X, the draft and the
 * same record, and nothing from X. DATABASE_URL,
 * BLUESKY_HANDLE, BLUESKY_APP_PASSWORD, DISCORD_WEBHOOK_URL,
 * X_BEARER_TOKEN, X_CLIENT_ID and X_CLIENT_SECRET come from the
 * environment only; .env files are not read. No dry run signs in; the
 * record (Discord's and X's) is in planning, which the studio's connection
 * may write (core's README, "The studio's connection"). X's sign-in is kept in
 * 1Password (through op, with OP_SERVICE_ACCOUNT_TOKEN), and each post
 * stores the new one.
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

const xLayer = XAnnounce.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Promo.layer,
      X.layer.pipe(Layer.provide(FetchHttpClient.layer)),
      XSignIn.onePassword,
      SentPosts.layer,
    ),
  ),
  Layer.provide(Database.layer),
);

const describeX = (prepared: PreparedXPost) =>
  [
    `X @${prepared.account.handle} · ${prepared.slug} · ${prepared.moment}`,
    "---",
    prepared.text,
    "---",
    prepared.sent === null
      ? "not posted yet"
      : prepared.sent.status === "sent"
        ? `already posted: ${prepared.sent.url ?? ""}`
        : `a post started at ${prepared.sent.claimedAt} isn't settled (${prepared.sent.status})`,
    `approval token: ${prepared.token}`,
  ].join("\n");

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

const xCommand = Command.make(
  "x",
  {
    slug,
    moment,
    dryRun,
    approve,
    sent: Flag.String("sent").pipe(
      Flag.withDescription(
        "Record the post an unanswered post left on our profile, by its id.",
      ),
      Flag.optional,
    ),
    release: Flag.Boolean("release").pipe(
      Flag.withDescription(
        "Let go of an unanswered post, once you've seen it isn't on our profile.",
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
            "Give one of --dry-run to read the post, --approve <token> to post exactly that, or, for a post that went unanswered, --sent <post id> to record the post it left or --release to let go of it.",
        });
      }
      if (Option.isSome(options.sent)) {
        const postId = options.sent.value;
        const recorded = yield* XAnnounce.use((announce) =>
          announce.recordSent(options.slug, options.moment, postId),
        );
        return yield* Console.log(
          options.json
            ? JSON.stringify(recorded, null, 2)
            : `Recorded as posted: ${recorded.url ?? postId}. Nothing was posted.`,
        );
      }
      if (options.release) {
        const released = yield* XAnnounce.use((announce) =>
          announce.release(options.slug, options.moment),
        );
        return yield* Console.log(
          options.json
            ? JSON.stringify(released, null, 2)
            : `Let go of the post started at ${released.claimedAt}. Nothing was posted; read it again with --dry-run to approve it.`,
        );
      }
      if (Option.isNone(options.approve)) {
        const prepared = yield* XAnnounce.use((announce) =>
          announce.prepare(options.slug, options.moment),
        );
        return yield* Console.log(
          options.json
            ? JSON.stringify(prepared, null, 2)
            : `${describeX(prepared)}\nNothing was posted. To post exactly this: bun run social x ${options.slug} --moment ${options.moment} --approve ${prepared.token}`,
        );
      }
      const token = options.approve.value;
      const posted = yield* XAnnounce.use((announce) =>
        announce.post(options.slug, options.moment, token),
      );
      return yield* Console.log(
        options.json
          ? JSON.stringify(posted, null, 2)
          : `Posted: ${posted.url}\n${describeX(posted)}`,
      );
    }).pipe(Effect.provide(xLayer)),
).pipe(
  Command.withDescription(
    "Post an evening's X draft as @allthingswebdev, exactly as approved.",
  ),
);

const xSignIn = Command.make(
  "x-sign-in",
  {
    fromXurl: Flag.Boolean("from-xurl").pipe(
      Flag.withDescription(
        'Keep the sign-in xurl stored for @allthingswebdev (its app "allthings").',
      ),
      Flag.withDefault(false),
    ),
    store: Flag.String("xurl-store").pipe(
      Flag.withDescription("xurl's store (default ~/.xurl/auth.yml)."),
      Flag.optional,
    ),
  },
  (options) =>
    Effect.gen(function* () {
      if (!options.fromXurl) {
        return yield* new PostRefused({
          reason: "Give --from-xurl: xurl's sign-in is the one this keeps.",
        });
      }
      const path = Option.getOrElse(
        options.store,
        () => `${process.env["HOME"] ?? ""}/.xurl/auth.yml`,
      );
      const yaml = yield* Effect.tryPromise({
        try: () => Bun.file(path).text(),
        catch: () =>
          new PostRefused({ reason: `xurl's store ${path} can't be read.` }),
      });
      const made = yield* fromXurl(yaml, "allthings", "allthingswebdev").pipe(
        Effect.catchTag("SignInUnavailable", (error) =>
          Effect.fail(new PostRefused({ reason: error.reason })),
        ),
      );
      const { verified } = yield* adoptSignIn(made);
      return yield* Console.log(
        `Kept xurl's sign-in${verified ? " for @allthingswebdev" : " (its access token has expired, so the first post checks the account)"} in 1Password "${signInItem.item}" (${signInItem.field}). Nothing was posted. The first post spends xurl's copy: xurl auth oauth2 --app allthings allthingswebdev signs xurl in again.`,
      );
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          X.layer.pipe(Layer.provide(FetchHttpClient.layer)),
          XSignIn.onePassword,
        ),
      ),
    ),
).pipe(
  Command.withDescription(
    "Keep @allthingswebdev's X sign-in (from xurl) in 1Password for posting.",
  ),
);

const social = Command.make("social").pipe(
  Command.withDescription("Post an evening's drafts from our accounts."),
  Command.withSubcommands([blueskyCommand, discordCommand, xCommand, xSignIn]),
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
