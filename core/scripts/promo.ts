import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import { channels, draftsJson, formatDrafts } from "../src/promo/format.ts";
import { Promo } from "../src/promo/promo.ts";

/**
 * Prints the promotion drafts for a published evening (src/promo/): its
 * Luma description, the Meetup cross-post with the settings to set by
 * hand, and posts for X, Bluesky, LinkedIn and Discord to announce it, on
 * the day, and after. Drafts only: nothing is posted. It only reads, so
 * production's read-only site_reader role is enough.
 *
 *   bun run promo <slug>                          every draft
 *   bun run promo <slug> --channel x --channel discord
 *   bun run promo <slug> --json                   with each draft's length
 *   bun run promo <draft slug> --draft            a draft evening's, as the studio reads it
 *
 * DATABASE_URL comes from the environment only; .env files are not read:
 *
 *   DATABASE_URL=$(op read "op://allthings/allthings site_reader/credential") \
 *     bun run promo 2026-06-26-all-things-effect-w-michael-arnaldi
 */

const command = Command.make(
  "promo",
  {
    slug: Argument.String("slug").pipe(
      Argument.withDescription("The evening's slug."),
    ),
    channel: Flag.Literals("channel", channels).pipe(
      Flag.withDescription(
        `Only these drafts (${channels.join(", ")}); repeat for more. All by default.`,
      ),
      Flag.atLeast(0),
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print the drafts as JSON, with their lengths."),
      Flag.withDefault(false),
    ),
    origin: Flag.String("origin").pipe(
      Flag.withDescription("The site's origin, for links to the evening."),
      Flag.withDefault("https://allthings.dev"),
    ),
    photoOrigin: Flag.String("photo-origin").pipe(
      Flag.withDescription("The origin photos are counted from."),
      Flag.withDefault("https://media.allthings.dev"),
    ),
    draft: Flag.Boolean("draft").pipe(
      Flag.withDescription(
        "Draft for a draft evening (not yet published), as the event studio does.",
      ),
      Flag.withDefault(false),
    ),
  },
  ({ slug, channel, json, origin, photoOrigin, draft }) =>
    Effect.gen(function* () {
      const drafts = yield* Promo.use((promo) =>
        promo.drafts(slug, { origin, photoOrigin, draft }),
      );
      const selected = channel.length === 0 ? channels : channel;
      yield* Console.log(
        json
          ? JSON.stringify(draftsJson(drafts, selected), null, 2)
          : formatDrafts(drafts, selected),
      );
    }).pipe(Effect.provide(Promo.layer.pipe(Layer.provide(Database.layer)))),
).pipe(
  Command.withDescription(
    "Print promotion drafts for an evening. Nothing is posted.",
  ),
);

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
