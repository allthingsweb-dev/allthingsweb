import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, DateTime, Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import { EventPages } from "../src/event-page.ts";
import { xHandle } from "../src/promo/drafts.ts";
import { formatLaunch, launchJson } from "../src/promo/format.ts";
import {
  launchChannels,
  launchDrafts,
  launchXHandle,
  type NextEvening,
  nextEveningOf,
} from "../src/promo/launch.ts";

/**
 * Prints the rebrand's launch kit (src/promo/launch.ts): the X thread, and
 * posts for Bluesky, LinkedIn and Discord, the Luma newsletter, an
 * announcement for each Meetup group, and the note for /about's history.
 * Drafts only: nothing is posted.
 *
 *   bun run promo:launch                           every draft, placeholders for what isn't settled
 *   bun run promo:launch --channel x --channel discord
 *   bun run promo:launch --x-handle allthingsdev   before launchXHandle is set
 *   bun run promo:launch --next <slug> --json      naming a published evening next
 *
 * Only --next reads the database, and only reads it, so production's
 * read-only site_reader role is enough. DATABASE_URL comes from the
 * environment only; .env files are not read:
 *
 *   DATABASE_URL=$(op read "op://Private/allthings site_reader/credential") \
 *     bun run promo:launch --next <slug>
 */

/** The evening at `slug` as the launch names it next, or why it can't be. */
const readNext = (slug: string, origin: string, photoOrigin: string) =>
  Effect.gen(function* () {
    const event = yield* EventPages.use((pages) =>
      pages.read(slug, photoOrigin),
    );
    const next = nextEveningOf(event, origin, yield* DateTime.now);
    if (next === "ended") {
      return yield* Effect.fail(
        new Error(`${slug} has ended: the launch names an upcoming evening.`),
      );
    }
    if (next === "shared") {
      return yield* Effect.fail(
        new Error(`${slug} is shared, not ours: the launch names one of ours.`),
      );
    }
    return next;
  }).pipe(Effect.provide(EventPages.layer), Effect.provide(Database.layer));

const command = Command.make(
  "promo:launch",
  {
    channel: Flag.Literals("channel", launchChannels).pipe(
      Flag.withDescription(
        `Only these drafts (${launchChannels.join(", ")}); repeat for more. All by default.`,
      ),
      Flag.atLeast(0),
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print the drafts as JSON, with their lengths."),
      Flag.withDefault(false),
    ),
    xHandle: Flag.String("x-handle").pipe(
      Flag.withDescription(
        "The X account's handle, in place of launchXHandle until it is set.",
      ),
      Flag.optional,
    ),
    next: Flag.String("next").pipe(
      Flag.withDescription(
        "The slug of the published evening to name next; a placeholder without it.",
      ),
      Flag.optional,
    ),
    origin: Flag.String("origin").pipe(
      Flag.withDescription("The site's origin."),
      Flag.withDefault("https://allthings.dev"),
    ),
    photoOrigin: Flag.String("photo-origin").pipe(
      Flag.withDescription("The origin photos are counted from, for --next."),
      Flag.withDefault("https://media.allthings.dev"),
    ),
  },
  ({ channel, json, xHandle: handleFlag, next, origin, photoOrigin }) =>
    Effect.gen(function* () {
      const handle = Option.getOrElse(handleFlag, () => launchXHandle);
      if (handle !== null && xHandle(handle) === null) {
        return yield* Effect.fail(new Error(`Not an X handle: ${handle}`));
      }
      const evening: NextEvening | null = Option.isSome(next)
        ? yield* readNext(next.value, origin, photoOrigin)
        : null;
      const drafts = launchDrafts({ origin, xHandle: handle, next: evening });
      const selected = channel.length === 0 ? launchChannels : channel;
      return yield* Console.log(
        json
          ? JSON.stringify(launchJson(drafts, selected), null, 2)
          : formatLaunch(drafts, selected),
      );
    }),
).pipe(
  Command.withDescription(
    "Print the rebrand's launch drafts. Nothing is posted.",
  ),
);

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
