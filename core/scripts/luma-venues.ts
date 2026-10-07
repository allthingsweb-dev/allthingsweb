import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as Database from "../src/database.ts";
import { LumaApi } from "../src/luma/api.ts";
import { formatVenues } from "../src/luma/venues-report.ts";
import { LumaVenues } from "../src/luma/venues.ts";

/**
 * Fills in the venue of every published event that has none, from Luma's
 * API, in the Postgres at DATABASE_URL (src/luma/venues.ts): the calendar
 * feed hides a venue Luma shows to guests only. The hourly sync does the
 * same (web/src/sync/run.ts); this runs it now.
 *
 *   bun run luma:venues --dry-run   ask Luma and print the venues; write nothing
 *   bun run luma:venues             the same, then write them
 *
 * DATABASE_URL and LUMA_API_KEY come from the environment only; .env files
 * are not read. Without LUMA_API_KEY it says so and does nothing. Pass both
 * without printing them, e.g.
 *
 *   DATABASE_URL=… LUMA_API_KEY=$(op read "op://allthings/allthings Luma API key/credential") \
 *     bun run luma:venues --dry-run
 */

const dryRunFlag = Flag.Boolean("dry-run").pipe(
  Flag.withDescription("Print what would be written without writing it."),
  Flag.withDefault(false),
);

const command = Command.make(
  "luma-venues",
  { dryRun: dryRunFlag },
  ({ dryRun }) =>
    LumaVenues.use((venues) => venues.run({ dryRun })).pipe(
      Effect.flatMap((result) => Console.log(formatVenues(result))),
      Effect.provide(
        LumaVenues.layer.pipe(
          Layer.provide(LumaApi.layer),
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(Database.layer),
        ),
      ),
    ),
).pipe(
  Command.withDescription(
    "Fill in each published event's missing venue from Luma's API.",
  ),
);

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
