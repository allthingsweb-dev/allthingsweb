import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import { applyLineups, Lineups } from "../src/lineups.ts";

/**
 * Applies core/backfill/lineups.json (src/lineups.ts) to the Postgres at
 * DATABASE_URL, in one transaction.
 *
 *   bun run lineups --dry-run   do everything, print it, roll back
 *   bun run lineups             the same, committed
 *
 * DATABASE_URL comes from the environment only; .env files are not read.
 */

const dryRunFlag = Flag.Boolean("dry-run").pipe(
  Flag.withDescription("Do everything, print it, then roll it back."),
  Flag.withDefault(false),
);

const command = Command.make("lineups", { dryRun: dryRunFlag }, ({ dryRun }) =>
  Effect.gen(function* () {
    const text = yield* Effect.promise(() =>
      Bun.file(new URL("../backfill/lineups.json", import.meta.url)).text(),
    );
    const lineups = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Lineups),
    )(text);
    const applied = yield* applyLineups(lineups, dryRun);
    yield* Console.log(applied.lines.join("\n"));
  }).pipe(Effect.provide(Database.layer)),
).pipe(Command.withDescription("Apply core/backfill/lineups.json."));

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
