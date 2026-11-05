import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { Command, Flag } from "effect/cli";
import { communityHistory, formatHistory } from "../src/community-metrics.ts";
import * as Database from "../src/database.ts";

/**
 * The community's public numbers, day by day (src/community-metrics.ts):
 * X, Bluesky, YouTube, Discord, Meetup, Luma, npm and GitHub, as the sync
 * Worker snapshots them each day. It only reads, as the studio (core's
 * README, "The community's numbers"):
 *
 *   DATABASE_URL=$(op read "op://allthings/allthings studio/credential") \
 *     bun run community               # the last 14 days
 *   … bun run community --days 90
 *
 * DATABASE_URL comes from the environment only; .env files are not read.
 */

const command = Command.make(
  "community",
  {
    days: Flag.Int("days").pipe(
      Flag.withDescription("Show the last this many days, today included."),
      Flag.filter(
        (days) => days >= 1 && days <= 3660,
        (days) => `--days must be 1 to 3660, not ${days}`,
      ),
      Flag.withDefault(14),
    ),
  },
  ({ days }) =>
    communityHistory(days).pipe(
      Effect.flatMap((rows) => Console.log(formatHistory(rows))),
      Effect.provide(Database.scriptLayer),
    ),
).pipe(
  Command.withDescription("Show the community's public numbers, day by day."),
);

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
