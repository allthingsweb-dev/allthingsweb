import { afterAll, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Cause, Effect, Exit, Schema } from "effect";
import * as Migrator from "effect/sql/Migrator";
import { SqlClient } from "effect/sql/SqlClient";
import { baseline } from "../migrations/0001_baseline.ts";
import { migrations } from "../migrations/index.ts";
import { statements } from "../migrations/statements.ts";
import * as Migrations from "../src/migrator.ts";
import * as SchemaSnapshot from "../src/schema-snapshot.ts";
import {
  expectedSchema,
  migratedDatabase,
  sqlLayer,
} from "./support/database.ts";
import { drizzleDatabase } from "./support/drizzle.ts";

/**
 * core/migrations against what they must reproduce: production's catalog
 * (tests/fixtures/production-schema.txt), and the app's drizzle history with
 * the changes production received by hand. Then the migrator's behavior:
 * runs, reruns, later migrations, and stamping a database built without it.
 */

const directory = new URL("../migrations/", import.meta.url);

/** Opened databases, closed after the suite. */
const opened: Array<PGlite> = [];
afterAll(async () => {
  await Promise.all(opened.map((db) => db.close()));
});

const keep = (db: PGlite): PGlite => {
  opened.push(db);
  return db;
};

const run = <A, E>(db: PGlite, effect: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromise(effect.pipe(Effect.provide(sqlLayer(db))));

const runExit = <A, E>(db: PGlite, effect: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromiseExit(effect.pipe(Effect.provide(sqlLayer(db))));

const snapshotOf = (db: PGlite) => run(db, SchemaSnapshot.snapshot);

/** The failure or defect an exit ended with, unwrapping the migrator's. */
function failureOf(exit: Exit.Exit<unknown, unknown>): unknown {
  if (Exit.isSuccess(exit)) throw new Error("expected a failure");
  const error = Cause.squash(exit.cause);
  return error instanceof Migrator.MigrationError && error.cause !== undefined
    ? error.cause
    : error;
}

/** An error's message and its causes', one per line. */
const messages = (error: unknown): string =>
  error instanceof Error ? `${error.message}\n${messages(error.cause)}` : "";

/** A database with `sql` applied directly, as drizzle built production. */
async function provisioned(sql: ReadonlyArray<string>): Promise<PGlite> {
  const db = keep(await PGlite.create());
  for (const statement of sql) await db.exec(statement);
  return db;
}

const Recorded = Schema.Array(
  Schema.Struct({ migration_id: Schema.Number, name: Schema.String }),
);

/** The rows of the migrator's record. */
const recorded = (db: PGlite) =>
  run(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient;
      return yield* Schema.decodeUnknownEffect(Recorded)(
        yield* sql`SELECT migration_id, name FROM ${sql(Migrations.table)} ORDER BY migration_id`,
      );
    }),
  );

/** A migration a later change could add. */
const addColumn = statements([
  `ALTER TABLE "public"."events" ADD COLUMN "capacity_note" text`,
]);

const withNext = Migrator.fromRecord({
  ...migrations,
  "0002_capacity_note": addColumn,
});

const production = (
  await Bun.file(
    new URL("fixtures/production-schema.txt", import.meta.url),
  ).text()
)
  .split("\n")
  .filter((line) => line !== "");

const isPlatformObject = (line: string) =>
  SchemaSnapshot.platformObjects.some(({ prefix }) => line.startsWith(prefix));

const fromMigrations = await Effect.runPromise(expectedSchema());

describe("core/migrations", () => {
  test("index.ts lists each migration file, with ids counting up from 1", async () => {
    const files = (await readdir(directory))
      .filter((file) => /^\d+_/.test(file))
      .toSorted();
    expect(files.map((file) => file.replace(/\.ts$/, ""))).toEqual(
      Object.keys(migrations).toSorted(),
    );
    for (const [index, file] of files.entries()) {
      expect(file).toMatch(/^\d{4}_[a-z0-9_]+\.ts$/);
      expect(Number(file.slice(0, 4))).toBe(index + 1);
      const module = (await import(new URL(file, directory).href)) as {
        default: unknown;
      };
      expect(module.default === migrations[file.replace(/\.ts$/, "")]).toBe(
        true,
      );
    }
  });

  test("they create production's schema", () => {
    const expected = production.filter((line) => !isPlatformObject(line));
    expect(
      SchemaSnapshot.format(SchemaSnapshot.diff(expected, fromMigrations)),
    ).toBe("");
  });

  test("every platform object exists on production", () => {
    for (const { prefix } of SchemaSnapshot.platformObjects) {
      expect(production.some((line) => line.startsWith(prefix))).toBe(true);
    }
  });

  test("a platform object does not change the snapshot", async () => {
    const db = keep(await migratedDatabase());
    await db.exec(
      `CREATE FUNCTION public.show_db_tree() RETURNS TABLE(tree_structure text) LANGUAGE sql AS $$ SELECT 'x' $$`,
    );
    expect(await snapshotOf(db)).toEqual(fromMigrations);
  });
});

/**
 * Where replaying app/migrations differs from production, each with the
 * reason: changes applied to production by hand that no drizzle migration
 * records. Lines are as the snapshot prints them, `baseline` for core's
 * migrations (production) and `drizzle` for the replay.
 */
const handApplied: ReadonlyArray<{
  readonly reason: string;
  readonly baseline: ReadonlyArray<string>;
  readonly drizzle: ReadonlyArray<string>;
}> = [
  {
    reason:
      "images.width and images.height were added on production after updated_at; 0000 creates them before created_at.",
    baseline: [
      "column public.images #005 created_at timestamp with time zone not null default now()",
      "column public.images #006 updated_at timestamp with time zone not null",
      "column public.images #007 width integer not null",
      "column public.images #008 height integer not null",
    ],
    drizzle: [
      "column public.images #005 width integer not null",
      "column public.images #006 height integer not null",
      "column public.images #007 created_at timestamp with time zone not null default now()",
      "column public.images #008 updated_at timestamp with time zone not null",
    ],
  },
  {
    reason:
      "Production's redirects key is named redirects_slug_unique; 0000 names it redirects_pkey.",
    baseline: [
      "constraint public.redirects redirects_slug_unique PRIMARY KEY (slug)",
      "index public.redirects CREATE UNIQUE INDEX redirects_slug_unique ON public.redirects USING btree (slug)",
    ],
    drizzle: [
      "constraint public.redirects redirects_pkey PRIMARY KEY (slug)",
      "index public.redirects CREATE UNIQUE INDEX redirects_pkey ON public.redirects USING btree (slug)",
    ],
  },
  {
    reason:
      "Production has no primary keys on event_sponsors and talk_speakers; 0000 creates them.",
    baseline: [],
    drizzle: [
      "constraint public.event_sponsors event_sponsors_event_id_sponsor_id_pk PRIMARY KEY (event_id, sponsor_id)",
      "index public.event_sponsors CREATE UNIQUE INDEX event_sponsors_event_id_sponsor_id_pk ON public.event_sponsors USING btree (event_id, sponsor_id)",
      "constraint public.talk_speakers talk_speakers_talk_id_speaker_id_pk PRIMARY KEY (talk_id, speaker_id)",
      "index public.talk_speakers CREATE UNIQUE INDEX talk_speakers_talk_id_speaker_id_pk ON public.talk_speakers USING btree (talk_id, speaker_id)",
    ],
  },
  {
    reason:
      "Production sets REPLICA IDENTITY FULL on events and images; no migration does.",
    baseline: [
      "relation public.events kind=r persistence=p rls=f force_rls=f replica_identity=f options=",
      "relation public.images kind=r persistence=p rls=f force_rls=f replica_identity=f options=",
    ],
    drizzle: [
      "relation public.events kind=r persistence=p rls=f force_rls=f replica_identity=d options=",
      "relation public.images kind=r persistence=p rls=f force_rls=f replica_identity=d options=",
    ],
  },
];

describe("against the app's drizzle history", () => {
  test("they differ only where production was changed by hand", async () => {
    const drizzle = await snapshotOf(keep(await drizzleDatabase()));
    const difference = SchemaSnapshot.diff(fromMigrations, drizzle);
    // Compared as text so a failure reads as a diff.
    expect(SchemaSnapshot.format(difference)).toBe(
      SchemaSnapshot.format({
        missing: handApplied
          .flatMap((entry) => entry.baseline)
          .toSorted(
            (a, b) => fromMigrations.indexOf(a) - fromMigrations.indexOf(b),
          ),
        unexpected: handApplied
          .flatMap((entry) => entry.drizzle)
          .toSorted((a, b) => drizzle.indexOf(a) - drizzle.indexOf(b)),
      }),
    );
  });

  /**
   * Breaking the baseline must break the comparison: each mutation, applied
   * to the baseline's text, shows up as exactly the lines it changes.
   */
  const mutations: ReadonlyArray<{
    readonly name: string;
    readonly from: string;
    readonly to: string;
    readonly missing: ReadonlyArray<string>;
    readonly unexpected: ReadonlyArray<string>;
  }> = [
    {
      name: "a foreign key's ON DELETE action",
      from: `REFERENCES "public"."events" ("id") ON DELETE CASCADE`,
      to: `REFERENCES "public"."events" ("id")`,
      missing: [
        "constraint public.event_review_sessions event_review_sessions_event_id_events_id_fk FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE",
      ],
      unexpected: [
        "constraint public.event_review_sessions event_review_sessions_event_id_events_id_fk FOREIGN KEY (event_id) REFERENCES events(id)",
      ],
    },
    {
      name: "an index's columns",
      from: `CONSTRAINT "events_slug_unique" UNIQUE ("slug")`,
      to: `CONSTRAINT "events_slug_unique" UNIQUE ("slug", "name")`,
      missing: [
        "constraint public.events events_slug_unique UNIQUE (slug)",
        "index public.events CREATE UNIQUE INDEX events_slug_unique ON public.events USING btree (slug)",
      ],
      unexpected: [
        "constraint public.events events_slug_unique UNIQUE (slug, name)",
        "index public.events CREATE UNIQUE INDEX events_slug_unique ON public.events USING btree (slug, name)",
      ],
    },
    {
      name: "a unique constraint",
      from: `,\n    CONSTRAINT "sponsors_name_unique" UNIQUE ("name")`,
      to: "",
      missing: [
        "constraint public.sponsors sponsors_name_unique UNIQUE (name)",
        "index public.sponsors CREATE UNIQUE INDEX sponsors_name_unique ON public.sponsors USING btree (name)",
      ],
      unexpected: [],
    },
    {
      name: "a default",
      from: `"status" text DEFAULT 'pending' NOT NULL`,
      to: `"status" text DEFAULT 'open' NOT NULL`,
      missing: [
        "column public.event_review_sessions #008 status text not null default 'pending'::text",
      ],
      unexpected: [
        "column public.event_review_sessions #008 status text not null default 'open'::text",
      ],
    },
    {
      name: "nullability",
      from: `"tagline" text NOT NULL`,
      to: `"tagline" text`,
      missing: ["column public.events #006 tagline text not null"],
      unexpected: ["column public.events #006 tagline text"],
    },
    {
      name: "an enum label",
      from: `ENUM ('organizer', 'member')`,
      to: `ENUM ('member', 'organizer')`,
      missing: ["enum public.profile_type ('organizer', 'member')"],
      unexpected: ["enum public.profile_type ('member', 'organizer')"],
    },
  ];

  for (const mutation of mutations) {
    test(`a changed baseline fails it: ${mutation.name}`, async () => {
      const mutated = baseline.map((statement) =>
        statement.replace(mutation.from, mutation.to),
      );
      expect(mutated).not.toEqual(baseline);
      const db = keep(
        await migratedDatabase(
          Migrator.fromRecord({ "0001_baseline": statements(mutated) }),
        ),
      );
      expect(SchemaSnapshot.diff(fromMigrations, await snapshotOf(db))).toEqual(
        {
          missing: mutation.missing,
          unexpected: mutation.unexpected,
        },
      );
    });
  }
});

describe("the migrator", () => {
  test("applies the baseline once; a second run is a no-op", async () => {
    const db = keep(await PGlite.create());
    expect(await run(db, Migrations.run())).toEqual([
      { id: 1, name: "baseline" },
    ]);
    expect(await run(db, Migrations.run())).toEqual([]);
    expect(await run(db, Migrations.plan())).toEqual({
      applied: [{ id: 1, name: "baseline" }],
      pending: [],
      provisioned: true,
    });
    expect(await recorded(db)).toEqual([{ migration_id: 1, name: "baseline" }]);
    expect(await snapshotOf(db)).toEqual(fromMigrations);
  });

  test("applies a later migration after the baseline, and only it", async () => {
    const db = keep(await migratedDatabase());
    expect(await run(db, Migrations.plan(withNext))).toMatchObject({
      pending: [{ id: 2, name: "capacity_note" }],
    });
    expect(await run(db, Migrations.run(withNext))).toEqual([
      { id: 2, name: "capacity_note" },
    ]);
    expect(SchemaSnapshot.diff(fromMigrations, await snapshotOf(db))).toEqual({
      missing: [],
      unexpected: ["column public.events #019 capacity_note text"],
    });
  });

  test("a dry run writes nothing", async () => {
    const db = keep(await PGlite.create());
    expect(await run(db, Migrations.plan())).toEqual({
      applied: [],
      pending: [{ id: 1, name: "baseline" }],
      provisioned: false,
    });
    expect(
      (
        await db.query(
          `SELECT to_regnamespace('${Migrations.recordSchema}') AS ns`,
        )
      ).rows,
    ).toEqual([{ ns: null }]);
    expect(await snapshotOf(db)).toEqual([]);
  });

  test("refuses a Neon Auth table other than the one it expects, recording nothing", async () => {
    // users_sync as app/migrations 0010 records it, not as Neon makes it.
    const db = await provisioned([
      `CREATE SCHEMA "neon_auth"`,
      `CREATE TABLE "neon_auth"."users_sync" ("raw_json" jsonb NOT NULL, "id" text PRIMARY KEY NOT NULL, "name" text, "email" text, "created_at" timestamp with time zone, "deleted_at" timestamp with time zone, "updated_at" timestamp with time zone)`,
    ]);
    const failure = failureOf(await runExit(db, Migrations.run()));
    expect(messages(failure)).toContain(
      "neon_auth.users_sync is not the table the baseline expects",
    );
    expect(await recorded(db)).toEqual([]);
    expect(await snapshotOf(db)).not.toContain(
      "relation public.events kind=r persistence=p rls=f force_rls=f replica_identity=f options=",
    );
  });

  test("refuses to run on a database that has the schema but no record", async () => {
    const db = await provisioned(baseline);
    const before = await snapshotOf(db);
    const failure = failureOf(await runExit(db, Migrations.run()));
    expect(failure).toBeInstanceOf(Migrator.MigrationError);
    expect(String(failure)).toContain("bun run migrate stamp");
    expect(await snapshotOf(db)).toEqual(before);
  });

  test("stamps a database already at the baseline without running it", async () => {
    // Production: the baseline's schema, built without the migrator.
    const db = await provisioned(baseline);
    await db.exec(
      `INSERT INTO "public"."redirects" (slug, destination_url, updated_at) VALUES ('kept', 'https://example.com', now())`,
    );
    const before = await snapshotOf(db);

    expect(await run(db, Migrations.stamp(fromMigrations))).toEqual([
      { id: 1, name: "baseline" },
    ]);
    expect(await recorded(db)).toEqual([{ migration_id: 1, name: "baseline" }]);
    // The baseline did not run: it would have failed on the existing tables.
    expect(await snapshotOf(db)).toEqual(before);
    expect((await db.query(`SELECT slug FROM redirects`)).rows).toEqual([
      { slug: "kept" },
    ]);

    // Stamping again records nothing; migrating continues from the stamp.
    expect(await run(db, Migrations.stamp(fromMigrations))).toEqual([]);
    expect(await run(db, Migrations.run())).toEqual([]);
    expect(await run(db, Migrations.run(withNext))).toEqual([
      { id: 2, name: "capacity_note" },
    ]);
  });

  test("refuses to stamp a database whose schema differs, recording nothing", async () => {
    const db = keep(await drizzleDatabase());
    const failure = failureOf(
      await runExit(db, Migrations.stamp(fromMigrations)),
    );
    expect(failure).toBeInstanceOf(Migrations.SchemaMismatch);
    expect(String(failure)).toContain(
      "+ constraint public.redirects redirects_pkey PRIMARY KEY (slug)",
    );
    expect(await recorded(db)).toEqual([]);
  });

  test("refuses a record that is not a prefix of the migrations", async () => {
    const db = keep(await migratedDatabase());
    await db.exec(
      `UPDATE ${Migrations.table} SET name = 'renamed' WHERE migration_id = 1`,
    );
    const failure = failureOf(await runExit(db, Migrations.run()));
    expect(failure).toMatchObject({ kind: "BadState" });
    expect(String(failure)).toContain("1_renamed");
  });

  test("refuses migrations whose ids skip a number", async () => {
    const db = keep(await migratedDatabase());
    const gap = Migrator.fromRecord({
      ...migrations,
      "0003_skipped": addColumn,
    });
    const failure = failureOf(await runExit(db, Migrations.run(gap)));
    expect(failure).toMatchObject({ kind: "BadState" });
    expect(String(failure)).toContain("3_skipped should have id 2");
  });
});
