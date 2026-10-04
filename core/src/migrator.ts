import { Effect, Schema } from "effect";
import * as Migrator from "effect/sql/Migrator";
import { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { loader as allMigrations } from "../migrations/index.ts";
import * as SchemaSnapshot from "./schema-snapshot.ts";

/**
 * Applies core/migrations with Effect SQL's migrator, which records each one
 * it runs in {@link table} and runs whatever has a higher id than the latest
 * recorded, all in one transaction under a table lock.
 *
 * The record lives in its own schema, as drizzle's does in `drizzle`, so the
 * app's drizzle migrations and these can share a database: neither tool reads
 * or writes the other's record, and drizzle-kit only manages `public`.
 *
 * Before running anything, {@link plan} checks that the record is a prefix of
 * the migrations here: the migrator alone would skip a migration merged with a
 * lower id than one already applied, or one renamed after it ran.
 */

/** The schema holding the record of applied migrations. */
export const recordSchema = "effect_sql";

/** The record of applied migrations, schema-qualified. */
export const table = `${recordSchema}.migrations`;

const migrate = Migrator.make({});

/** A migration as the migrator identifies it. */
export interface MigrationId {
  readonly id: number;
  readonly name: string;
}

/** Where a database stands against the migrations here. */
export interface Plan {
  /** Migrations the record says ran, in id order. */
  readonly applied: ReadonlyArray<MigrationId>;
  /** Migrations a run would apply, in id order. */
  readonly pending: ReadonlyArray<MigrationId>;
  /** Whether `public` holds any relation, i.e. the app's schema exists. */
  readonly provisioned: boolean;
}

/** The live schema differs from what the migrations create. */
export class SchemaMismatch extends Schema.TaggedError<SchemaMismatch>()(
  "SchemaMismatch",
  {
    missing: Schema.Array(Schema.String),
    unexpected: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return `The database's schema differs from what the migrations create (- expected only, + database only):\n${SchemaSnapshot.format(this)}`;
  }
}

const Recorded = Schema.Struct({
  migration_id: Schema.Number,
  name: Schema.String,
});

const Exists = Schema.Struct({ exists: Schema.Boolean });

const badState = (message: string) =>
  new Migrator.MigrationError({ kind: "BadState", message });

const label = ({ id, name }: MigrationId): string => `${id}_${name}`;

/**
 * Where the database stands, read without writing anything: what ran, what
 * would run, and whether the app's schema exists. Fails if the record is not
 * a prefix of `loader`'s migrations.
 */
export const plan = (
  loader: Migrator.Loader = allMigrations,
): Effect.Effect<
  Plan,
  Migrator.MigrationError | SqlError | Schema.SchemaError,
  SqlClient
> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const [recordExists] = yield* sql`
      SELECT to_regclass(${table}) IS NOT NULL AS "exists"`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Exists))),
    );
    const applied: ReadonlyArray<MigrationId> = recordExists?.exists
      ? (yield* sql`
          SELECT migration_id, name FROM ${sql(table)}
          ORDER BY migration_id`.withoutTransform.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Recorded))),
        )).map(({ migration_id, name }) => ({ id: migration_id, name }))
      : [];
    const known = (yield* loader).map(([id, name]) => ({ id, name }));

    for (const [index, migration] of known.entries()) {
      if (!Number.isSafeInteger(migration.id) || migration.id !== index + 1) {
        return yield* badState(
          `Migration ${label(migration)} should have id ${index + 1}: ids count up from 1 without gaps.`,
        );
      }
    }
    for (const [index, migration] of applied.entries()) {
      const expected = known[index];
      if (
        expected === undefined ||
        expected.id !== migration.id ||
        expected.name !== migration.name
      ) {
        return yield* badState(
          `The database records ${label(migration)} as applied, where the migrations have ${expected === undefined ? "nothing" : label(expected)}. Applied migrations are never renamed, reordered or removed.`,
        );
      }
    }

    const [publicRelations] = yield* sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      ) AS "exists"`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Exists))),
    );

    return {
      applied,
      pending: known.slice(applied.length),
      provisioned: publicRelations?.exists ?? false,
    };
  });

const ensureRecordSchema = Effect.gen(function* () {
  const sql = yield* SqlClient;
  yield* sql`CREATE SCHEMA IF NOT EXISTS ${sql(recordSchema)}`;
});

/**
 * Applies the pending migrations and returns them. Refuses a database that
 * already has the app's schema but no record: that is production before it is
 * stamped (see {@link stamp}), where running the baseline would only fail.
 */
export const run = (
  loader: Migrator.Loader = allMigrations,
): Effect.Effect<
  ReadonlyArray<MigrationId>,
  Migrator.MigrationError | SqlError | Schema.SchemaError,
  SqlClient
> =>
  Effect.gen(function* () {
    const { applied, provisioned } = yield* plan(loader);
    if (applied.length === 0 && provisioned) {
      return yield* badState(
        "The database already has tables in public but records no migrations. If its schema is what the migrations create, stamp it instead (bun run migrate stamp).",
      );
    }
    yield* ensureRecordSchema;
    const ran = yield* migrate({ loader, table });
    return ran.map(([id, name]) => ({ id, name }));
  });

/**
 * A failed migration's reason, for a person: the failure's message and each
 * cause's under it, one per line, without repeats. The migrator wraps a
 * failed statement's error (a migration's own RAISE, say) several levels
 * down, under messages such as "PgConnection: Query failed".
 */
export function failureMessage(failure: Error): string {
  const lines: Array<string> = [];
  let current: unknown = failure;
  // Bounded, in case a cause chain loops.
  for (let depth = 0; current instanceof Error && depth < 10; depth++) {
    if (!lines.includes(current.message)) lines.push(current.message);
    current = current.cause;
  }
  return lines.join("\n");
}

/** Fails with the difference unless the live schema equals `expected`. */
export const verify = (
  expected: ReadonlyArray<string>,
): Effect.Effect<
  void,
  SchemaMismatch | SqlError | Schema.SchemaError,
  SqlClient
> =>
  Effect.gen(function* () {
    const difference = SchemaSnapshot.diff(
      expected,
      yield* SchemaSnapshot.snapshot,
    );
    if (!SchemaSnapshot.isEmpty(difference)) {
      yield* new SchemaMismatch(difference);
    }
  });

/**
 * Records the pending migrations as applied without running them, for a
 * database whose schema already is what they create: production, which
 * drizzle built. `expected` is that schema, as {@link SchemaSnapshot.snapshot}
 * reads it from a database the migrations built.
 *
 * It runs through the migrator, so the record is exactly what a run would
 * write, but with each pending migration replaced by nothing, except the last,
 * which checks the live schema against `expected`. A mismatch fails it (as a
 * defect wrapping {@link SchemaMismatch}, the way the migrator reports a
 * failed migration), and the transaction records nothing. To undo a stamp, delete its rows from
 * {@link table}.
 */
export const stamp = (
  expected: ReadonlyArray<string>,
  loader: Migrator.Loader = allMigrations,
): Effect.Effect<
  ReadonlyArray<MigrationId>,
  Migrator.MigrationError | SqlError | Schema.SchemaError,
  SqlClient
> =>
  Effect.gen(function* () {
    const { pending } = yield* plan(loader);
    const last = pending.at(-1);
    if (last === undefined) return [];
    yield* ensureRecordSchema;
    const stamped = yield* migrate({
      table,
      loader: Effect.map(loader, (resolved) =>
        resolved.map(
          ([id, name]): Migrator.ResolvedMigration => [
            id,
            name,
            Effect.succeed(id === last.id ? verify(expected) : Effect.void),
          ],
        ),
      ),
    });
    return stamped.map(([id, name]) => ({ id, name }));
  });
