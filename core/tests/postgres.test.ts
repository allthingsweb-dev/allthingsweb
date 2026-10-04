import { afterAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { PgClient } from "@effect/sql-pg";
import { Effect, Redacted } from "effect";
import * as Migrator from "effect/sql/Migrator";
import type { SqlClient } from "effect/sql/SqlClient";
import baselineMigration, { baseline } from "../migrations/0001_baseline.ts";
import { migrations } from "../migrations/index.ts";
import { isTopic } from "../src/lockup.ts";
import * as Migrations from "../src/migrator.ts";
import * as SchemaSnapshot from "../src/schema-snapshot.ts";
import { expectedSchema } from "./support/database.ts";
import { notTopics, topics } from "./support/topics.ts";

/**
 * The migrator against a real Postgres server, the major version production
 * runs, where the other tests use PGlite (Postgres 18): the migrations must
 * create production's catalog there too, stamping must work over the wire
 * protocol production uses, and the CHECK on events.topic must read topics
 * as src/lockup.ts does.
 *
 * Needs `CORE_TEST_POSTGRES_URL`, a superuser connection string such as CI's
 * service container provides. Each test creates its own database there and
 * drops it afterwards.
 */

const serverUrl = process.env["CORE_TEST_POSTGRES_URL"];

/** Every migration here, in id order, as the migrator reports them. */
const all = Object.keys(migrations)
  .toSorted()
  .map((key) => ({ id: Number(key.slice(0, 4)), name: key.slice(5) }));

/** The baseline alone, which production was stamped at. */
const baselineOnly = Migrator.fromRecord({
  "0001_baseline": baselineMigration,
});

if (serverUrl === undefined) {
  test.skip("against a real Postgres (set CORE_TEST_POSTGRES_URL)", () => {});
} else {
  const admin = new SQL(serverUrl);
  const created: Array<string> = [];
  afterAll(async () => {
    for (const database of created) {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    }
    await admin.close();
  });

  /** A new, empty database's connection string. */
  const freshDatabase = async (name: string): Promise<string> => {
    const database = `allthings_core_test_${process.pid}_${name}`;
    await admin.unsafe(`CREATE DATABASE ${database}`);
    created.push(database);
    const url = new URL(serverUrl);
    url.pathname = `/${database}`;
    return url.href;
  };

  const on = <A, E>(url: string, effect: Effect.Effect<A, E, SqlClient>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(PgClient.layer({ url: Redacted.make(url) }))),
    );

  const production = (
    await Bun.file(
      new URL("fixtures/production-schema.txt", import.meta.url),
    ).text()
  )
    .split("\n")
    .filter(
      (line) =>
        line !== "" &&
        !SchemaSnapshot.platformObjects.some(({ prefix }) =>
          line.startsWith(prefix),
        ),
    );

  describe("against a real Postgres", () => {
    test("the migrations create production's schema, once", async () => {
      const url = await freshDatabase("run");
      expect(await on(url, Migrations.run())).toEqual(all);
      expect(await on(url, Migrations.run())).toEqual([]);
      expect(
        SchemaSnapshot.format(
          SchemaSnapshot.diff(
            production,
            await on(url, SchemaSnapshot.snapshot),
          ),
        ),
      ).toBe("");
    });

    test("stamps a database built without the migrator, then migrates it", async () => {
      const url = await freshDatabase("stamp");
      const sql = new SQL(url);
      try {
        for (const statement of baseline) await sql.unsafe(statement);
      } finally {
        await sql.close();
      }
      const atBaseline = await Effect.runPromise(expectedSchema(baselineOnly));
      expect(await on(url, Migrations.stamp(atBaseline, baselineOnly))).toEqual(
        [{ id: 1, name: "baseline" }],
      );
      expect(await on(url, Migrations.plan())).toMatchObject({
        applied: [{ id: 1, name: "baseline" }],
        pending: all.slice(1),
      });
      // As `bun run migrate` does on production after each merge.
      expect(await on(url, Migrations.run())).toEqual(all.slice(1));
      expect(
        SchemaSnapshot.format(
          SchemaSnapshot.diff(
            production,
            await on(url, SchemaSnapshot.snapshot),
          ),
        ),
      ).toBe("");
    });

    test("the CHECK on events.topic agrees with isTopic", async () => {
      const url = await freshDatabase("topic");
      await on(url, Migrations.run());
      const sql = new SQL(url);
      try {
        for (const topic of [...topics, ...notTopics]) {
          const stored = await sql`
            INSERT INTO events (slug, name, tagline, start_date, end_date, attendee_limit, updated_at, topic)
            VALUES (gen_random_uuid()::text, 'Event', '', now(), now(), 0, now(), ${topic})`.then(
            () => true,
            (error: unknown) => {
              if (String(error).includes("events_topic_check")) return false;
              throw error;
            },
          );
          expect({ topic, stored }).toEqual({ topic, stored: isTopic(topic) });
        }
      } finally {
        await sql.close();
      }
    });
  });
}
