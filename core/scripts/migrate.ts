import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Cause, Console, Effect } from "effect";
import { Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import * as Migrations from "../src/migrator.ts";
import { expectedSchema } from "./pglite.ts";

/**
 * Applies core/migrations to the Postgres at DATABASE_URL.
 *
 *   bun run migrate [--dry-run]         apply what is pending
 *   bun run migrate stamp [--dry-run]   record what is pending as applied,
 *                                       if the schema already is what it creates
 *
 * --dry-run only reads: it lists what would run or be recorded, and for stamp
 * fails, showing the difference, unless the schema matches. DATABASE_URL must be set in the environment;
 * .env files are not read, so no stored URL is ever picked up by accident.
 */

const dryRunFlag = Flag.Boolean("dry-run").pipe(
  Flag.withDescription("List what would happen without writing anything."),
  Flag.withDefault(false),
);

const label = ({ id, name }: Migrations.MigrationId): string =>
  `${String(id).padStart(4, "0")}_${name}`;

const list = (
  title: string,
  migrations: ReadonlyArray<Migrations.MigrationId>,
) =>
  Console.log(
    migrations.length === 0
      ? `${title}: none`
      : [`${title}:`, ...migrations.map((m) => `  ${label(m)}`)].join("\n"),
  );

/**
 * The migrator turns a failed migration into a defect; this surfaces the
 * reason (for a stamp, the schema diff; for a statement, Postgres's error,
 * such as a migration's own RAISE) as the command's error.
 */
const surfaceFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.catchDefect(effect, (defect) =>
    Effect.fail(
      new Error(
        defect instanceof Error
          ? Migrations.failureMessage(defect)
          : Cause.pretty(Cause.die(defect)),
      ),
    ),
  );

const stamp = Command.make("stamp", { dryRun: dryRunFlag }, ({ dryRun }) =>
  Effect.gen(function* () {
    const { applied, pending } = yield* Migrations.plan();
    yield* list("Applied", applied);
    if (pending.length === 0) {
      yield* Console.log("Nothing to stamp.");
    } else if (dryRun) {
      yield* list("Would record as applied", pending);
      yield* Migrations.verify(yield* expectedSchema());
      yield* Console.log("The schema matches: stamping would succeed.");
    } else {
      const expected = yield* expectedSchema();
      yield* list("Recorded as applied", yield* Migrations.stamp(expected));
    }
  }).pipe(surfaceFailure, Effect.provide(Database.layer)),
).pipe(
  Command.withDescription(
    "Record pending migrations as applied, without running them, on a database whose schema already is what they create.",
  ),
);

const migrate = Command.make("migrate", { dryRun: dryRunFlag }, ({ dryRun }) =>
  Effect.gen(function* () {
    const { applied, pending } = yield* Migrations.plan();
    yield* list("Applied", applied);
    if (dryRun) {
      yield* list("Would apply", pending);
    } else {
      yield* list("Applied now", yield* Migrations.run());
    }
  }).pipe(surfaceFailure, Effect.provide(Database.layer)),
).pipe(
  Command.withDescription("Apply pending migrations to DATABASE_URL."),
  Command.withSubcommands([stamp]),
);

Command.run(migrate, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
