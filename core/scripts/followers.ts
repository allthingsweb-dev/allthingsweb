import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as Database from "../src/database.ts";
import { FollowerSource, refreshFollowers } from "../src/followers.ts";

/**
 * Refreshes X follower counts (src/followers.ts) in the Postgres at
 * DATABASE_URL, from the FixTweet API: the profiles whose snapshot is
 * missing or older than --stale-days, oldest first, at most --max. The sync
 * Worker does the same on its schedule; this is for now.
 *
 *   bun run followers --dry-run   read the counts and print them; write nothing
 *   bun run followers             the same, stored
 *
 * DATABASE_URL comes from the environment only; .env files are not read.
 */

const command = Command.make(
  "followers",
  {
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Read the counts and print them; write nothing."),
      Flag.withDefault(false),
    ),
    max: Flag.Int("max").pipe(
      Flag.withDescription("Read at most this many profiles."),
      Flag.filter(
        (max) => max >= 1,
        (max) => `--max must be at least 1, not ${max}`,
      ),
      Flag.withDefault(500),
    ),
    staleDays: Flag.Int("stale-days").pipe(
      Flag.withDescription(
        "Leave counts newer than this many days alone; 0 reads every one.",
      ),
      Flag.filter(
        (days) => days >= 0,
        (days) => `--stale-days must be 0 or more, not ${days}`,
      ),
      Flag.withDefault(7),
    ),
  },
  ({ dryRun, max, staleDays }) =>
    Effect.gen(function* () {
      const report = yield* refreshFollowers({
        dryRun,
        maxProfiles: max,
        staleAfter: `${staleDays} days`,
      });
      yield* Console.log(
        [
          ...report.refreshed,
          ...report.failed.map((line) => `failed: ${line}`),
          `${report.refreshed.length} read, ${report.failed.length} failed, ${report.remaining} left for later${dryRun ? " (dry run: nothing written)" : ""}.`,
        ].join("\n"),
      );
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          FollowerSource.fxtwitter.pipe(Layer.provide(FetchHttpClient.layer)),
          Database.layer,
        ),
      ),
    ),
).pipe(Command.withDescription("Refresh X follower counts from public data."));

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
