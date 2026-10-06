import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as Database from "../src/database.ts";
import { LumaApi } from "../src/luma/api.ts";
import { formatDescriptions } from "../src/luma/descriptions-report.ts";
import { LumaDescriptions } from "../src/luma/descriptions.ts";

/**
 * Imports every published event's description from Luma's API into the
 * Postgres at DATABASE_URL, and replaces placeholder taglines with each
 * description's summary (src/luma/descriptions.ts). The hourly sync does
 * the same (web/src/sync/run.ts); this runs it now, for every event.
 *
 *   bun run luma:descriptions --dry-run   ask Luma and print the changes; write nothing
 *   bun run luma:descriptions             the same, then write them
 *
 * DATABASE_URL and LUMA_API_KEY come from the environment only; .env files
 * are not read. Without LUMA_API_KEY it says so and does nothing. Pass both
 * without printing them, e.g.
 *
 *   DATABASE_URL=… LUMA_API_KEY=$(op read "op://Private/allthings Luma API key/credential") \
 *     bun run luma:descriptions --dry-run
 */

const dryRunFlag = Flag.Boolean("dry-run").pipe(
  Flag.withDescription("Print what would be written without writing it."),
  Flag.withDefault(false),
);

const command = Command.make(
  "luma-descriptions",
  { dryRun: dryRunFlag },
  ({ dryRun }) =>
    LumaDescriptions.use((descriptions) => descriptions.run({ dryRun })).pipe(
      Effect.flatMap((result) => Console.log(formatDescriptions(result))),
      Effect.provide(
        LumaDescriptions.layer.pipe(
          Layer.provide(LumaApi.layer),
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(Database.layer),
        ),
      ),
    ),
).pipe(
  Command.withDescription(
    "Import each published event's description from Luma.",
  ),
);

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
