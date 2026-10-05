import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as Database from "../src/database.ts";
import { LumaApi } from "../src/luma/api.ts";
import { LumaPeopleSync } from "../src/luma/people-sync.ts";
import { formatImport } from "../src/luma/people-report.ts";

/**
 * Imports each published event's hosts and guest counts from Luma's API into
 * the Postgres at DATABASE_URL (src/luma/people-sync.ts).
 *
 *   bun run luma:people --dry-run   ask Luma and print the plan; write nothing
 *   bun run luma:people             the same, then write it
 *
 * Hosts it cannot match are left out and listed. Decide each, check with
 * --dry-run, then run with the decisions:
 *
 *   --create usr-…             make a profile for that host (repeatable)
 *   --link usr-…=<profile id>  that host is an existing profile (repeatable)
 *
 * DATABASE_URL and LUMA_API_KEY come from the environment only; .env files
 * are not read. Without LUMA_API_KEY it says so and does nothing. Pass both
 * without printing them, e.g.
 *
 *   DATABASE_URL=… LUMA_API_KEY=$(op read "op://Private/allthings Luma API key/credential") \
 *     bun run luma:people --dry-run
 */

const dryRunFlag = Flag.Boolean("dry-run").pipe(
  Flag.withDescription("Print what would be written without writing it."),
  Flag.withDefault(false),
);

const createFlag = Flag.String("create").pipe(
  Flag.withDescription("A host's Luma user id to make a profile for."),
  Flag.atLeast(0),
);

const linkFlag = Flag.KeyValuePair("link").pipe(
  Flag.withDescription(
    "<Luma user id>=<profile id>: a host who has a profile.",
  ),
  Flag.withDefault({}),
);

const command = Command.make(
  "luma-people",
  { dryRun: dryRunFlag, create: createFlag, link: linkFlag },
  ({ dryRun, create, link }) =>
    LumaPeopleSync.use((sync) =>
      sync.run({ dryRun, decisions: { create, link } }),
    ).pipe(
      Effect.flatMap((result) => Console.log(formatImport(result))),
      Effect.provide(
        LumaPeopleSync.layer.pipe(
          Layer.provide(LumaApi.layer),
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(Database.layer),
        ),
      ),
    ),
).pipe(
  Command.withDescription(
    "Import each published event's hosts and guest counts from Luma.",
  ),
);

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
