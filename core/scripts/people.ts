import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import { applyPeople, decodePeopleFile } from "../src/people-enrichment.ts";

/**
 * Applies people's sourced titles, bios, links and photos
 * (core/backfill/people.json, src/people-enrichment.ts) to the Postgres at
 * DATABASE_URL, in one transaction.
 *
 *   bun run people [file] --dry-run   do everything, print it, roll back
 *   bun run people [file]             the same, committed
 *
 * DATABASE_URL comes from the environment only; .env files are not read.
 */

const command = Command.make(
  "people",
  {
    file: Argument.String("file").pipe(
      Argument.withDescription("The people's facts, with their sources."),
      Argument.withDefault("backfill/people.json"),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Do everything, print it, then roll it back."),
      Flag.withDefault(false),
    ),
  },
  ({ file, dryRun }) =>
    Effect.gen(function* () {
      const text = yield* Effect.promise(() =>
        Bun.file(new URL(`../${file}`, import.meta.url)).text(),
      );
      const links = yield* decodePeopleFile(text);
      const lines = yield* applyPeople(links, dryRun);
      yield* Console.log(lines.join("\n"));
    }).pipe(Effect.provide(Database.layer)),
).pipe(
  Command.withDescription(
    "Fill people's profiles from sourced facts; a filled value is replaced only where the file names it as stale.",
  ),
);

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
