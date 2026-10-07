import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as Database from "../src/database.ts";
import { LumaApi } from "../src/luma/api.ts";
import { formatDrafts, LumaDrafts } from "../src/luma/drafts.ts";

/**
 * Refreshes every draft we know from Luma's API (src/luma/drafts.ts): the
 * calendar feed carries no private event, so a draft's name, times and
 * venue go stale without it. Read-only on Luma. The hourly sync does the
 * same (web/src/sync/run.ts); this runs it now.
 *
 *   bun run luma:drafts --dry-run   ask Luma and print what would change; write nothing
 *   bun run luma:drafts             the same, then write it
 *
 * DATABASE_URL and LUMA_API_KEY come from the environment only; .env files
 * are not read. Without LUMA_API_KEY it says so and does nothing.
 */

const dryRunFlag = Flag.Boolean("dry-run").pipe(
  Flag.withDescription("Print what would be written without writing it."),
  Flag.withDefault(false),
);

const command = Command.make(
  "luma-drafts",
  { dryRun: dryRunFlag },
  ({ dryRun }) =>
    LumaDrafts.use((drafts) => drafts.run({ dryRun })).pipe(
      Effect.flatMap((result) => Console.log(formatDrafts(result))),
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

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
