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
import { Bluesky } from "../src/social/bluesky.ts";

/**
 * Posts an evening's promotion draft (src/promo/) from our accounts, exactly
 * as approved (src/social/):
 *
 *   bun run social bluesky <slug> --moment announce --dry-run    the post, and its approval token
 *   bun run social bluesky <slug> --moment announce --approve <token>   post exactly that, once
 *
 * --dry-run reads only: the draft, the handles it mentions, and our recent
 * posts, to say whether this text is already out. DATABASE_URL,
 * BLUESKY_HANDLE and BLUESKY_APP_PASSWORD come from the environment only;
 * .env files are not read, and the dry run needs no password.
 */

const layer = Announce.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Promo.layer,
      Bluesky.layer.pipe(Layer.provide(FetchHttpClient.layer)),
    ),
  ),
  Layer.provide(Database.layer),
);

const describe = (prepared: PreparedPost) =>
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

const bluesky = Command.make(
  "bluesky",
  {
    slug: Argument.String("slug").pipe(
      Argument.withDescription("The published evening's slug."),
    ),
    moment: Flag.Literals("moment", moments).pipe(
      Flag.withDescription(`Which draft (${moments.join(", ")}).`),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Print the post and its token; post nothing."),
      Flag.withDefault(false),
    ),
    approve: Flag.String("approve").pipe(
      Flag.withDescription("The token --dry-run printed: post exactly that."),
      Flag.optional,
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print the result as JSON."),
      Flag.withDefault(false),
    ),
  },
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
            : `${describe(prepared)}\nNothing was posted. To post exactly this: bun run social bluesky ${options.slug} --moment ${options.moment} --approve ${prepared.token}`,
        );
      }
      const token = options.approve.value;
      const posted = yield* Announce.use((announce) =>
        announce.post(options.slug, options.moment, token),
      );
      return yield* Console.log(
        options.json
          ? JSON.stringify(posted, null, 2)
          : `Posted: ${posted.url}\n${describe(posted)}`,
      );
    }).pipe(Effect.provide(layer)),
).pipe(
  Command.withDescription(
    "Post an evening's Bluesky draft from @allthingsweb.dev, exactly as approved.",
  ),
);

const social = Command.make("social").pipe(
  Command.withDescription("Post an evening's drafts from our accounts."),
  Command.withSubcommands([bluesky]),
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
