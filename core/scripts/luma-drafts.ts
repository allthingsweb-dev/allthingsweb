import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as Database from "../src/database.ts";
import { LumaApi } from "../src/luma/api.ts";
import { formatAdded, formatDrafts, LumaDrafts } from "../src/luma/drafts.ts";

/**
 * Refreshes every draft we know from Luma's API (src/luma/drafts.ts): the
 * calendar feed carries no private event, so a draft's name, times and
 * venue go stale without it. Read-only on Luma. The hourly sync does the
 * same (web/src/sync/run.ts); this runs it now.
 *
 *   bun run luma:drafts --dry-run   ask Luma and print what would change; write nothing
 *   bun run luma:drafts             the same, then write it
 *   bun run luma:drafts --add evt-… --dry-run   what storing a private event as a draft would write
 *   bun run luma:drafts --add evt-…             store it: the feed never carries it
 *
 * DATABASE_URL and LUMA_API_KEY come from the environment only; .env files
 * are not read. Without LUMA_API_KEY it says so and does nothing.
 */

const dryRunFlag = Flag.Boolean("dry-run").pipe(
  Flag.withDescription("Print what would be written without writing it."),
  Flag.withDefault(false),
);

const addFlag = Flag.String("add").pipe(
  Flag.withDescription(
    "Store this private Luma event (evt-…) as a draft evening, as the studio's new evenings need: the feed never carries a private event.",
  ),
  Flag.optional,
);

const command = Command.make(
  "luma-drafts",
  { dryRun: dryRunFlag, add: addFlag },
  ({ dryRun, add }) =>
    (Option.isSome(add)
      ? LumaDrafts.use((drafts) => drafts.add(add.value, { dryRun })).pipe(
          Effect.flatMap((added) => Console.log(formatAdded(added))),
        )
      : LumaDrafts.use((drafts) => drafts.run({ dryRun })).pipe(
          Effect.flatMap((result) => Console.log(formatDrafts(result))),
        )
    ).pipe(
      Effect.provide(
        LumaDrafts.layer.pipe(
          Layer.provide(LumaApi.layer),
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(Database.layer),
        ),
      ),
    ),
).pipe(
  Command.withDescription(
    "Refresh each draft's name, times and venue from Luma's API.",
  ),
);

// A refusal is the answer, not a crash: its reason alone, on stderr, and exit 1.
Command.run(command, { version: "1.0.0" }).pipe(
  Effect.catchTag("DraftNotAdded", (refusal) =>
    Effect.sync(() => {
      console.error(refusal.reason);
      process.exitCode = 1;
    }),
  ),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
