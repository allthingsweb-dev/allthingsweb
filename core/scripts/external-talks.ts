import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import {
  applyExternalTalks,
  decodeExternalTalksFile,
} from "../src/external-talks.ts";

/**
 * Applies talks people gave elsewhere (core/backfill/external-talks.json,
 * src/external-talks.ts) to the Postgres at DATABASE_URL, in one
 * transaction.
 *
 *   bun run external-talks [file] --dry-run   do everything, print it, roll back
 *   bun run external-talks [file]             the same, committed
 *
 * DATABASE_URL comes from the environment only; .env files are not read.
 */

const command = Command.make(
  "external-talks",
  {
    file: Argument.String("file").pipe(
      Argument.withDescription("The talks, with their sources."),
      Argument.withDefault("backfill/external-talks.json"),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Do everything, print it, then roll it back."),
      Flag.withDefault(false),
    ),
  },
  ({ file, dryRun }) =>
    Effect.gen(function* () {
      const text = yield* Effect.tryPromise({
        try: () => Bun.file(new URL(`../${file}`, import.meta.url)).text(),
        catch: (cause) =>
          new Error(`Could not read ${file}: ${String(cause)}`, { cause }),
      });
      const talks = yield* decodeExternalTalksFile(text);
      const lines = yield* applyExternalTalks(talks, dryRun);
      yield* Console.log(lines.join("\n"));
    }).pipe(Effect.provide(Database.layer)),
).pipe(Command.withDescription("Apply talks people gave elsewhere."));

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
