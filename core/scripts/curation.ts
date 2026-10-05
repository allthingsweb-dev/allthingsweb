import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import { applyCuration, CurationFile } from "../src/curation.ts";

/**
 * Applies core/backfill/curation.json (src/curation.ts) to the
 * Postgres at DATABASE_URL, in one transaction.
 *
 *   bun run curation --dry-run   do everything, print it, roll back
 *   bun run curation             the same, committed
 *
 * DATABASE_URL comes from the environment only; .env files are not read.
 */

const dryRunFlag = Flag.Boolean("dry-run").pipe(
  Flag.withDescription("Do everything, print it, then roll it back."),
  Flag.withDefault(false),
);

const command = Command.make("curation", { dryRun: dryRunFlag }, ({ dryRun }) =>
  Effect.gen(function* () {
    const text = yield* Effect.promise(() =>
      Bun.file(new URL("../backfill/curation.json", import.meta.url)).text(),
    );
    const file = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(CurationFile),
    )(text);
    const applied = yield* applyCuration(file, dryRun);
    yield* Console.log(applied.join("\n"));
  }).pipe(Effect.provide(Database.layer)),
).pipe(Command.withDescription("Apply core/backfill/curation.json."));

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
