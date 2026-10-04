import { afterAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { PgClient } from "@effect/sql-pg";
import { Effect, Redacted } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import { baseline } from "../migrations/0001_baseline.ts";
import * as Migrations from "../src/migrator.ts";
import * as SchemaSnapshot from "../src/schema-snapshot.ts";
import { expectedSchema } from "./support/database.ts";

/**
 * The migrator against a real Postgres server, the major version production
 * runs, where the other tests use PGlite (Postgres 18): the migrations must
 * create production's catalog there too, and stamping must work over the
 * wire protocol production will use.
 *
 * Needs `CORE_TEST_POSTGRES_URL`, a superuser connection string such as CI's
 * service container provides. Each test creates its own database there and
 * drops it afterwards.
 */

const serverUrl = process.env["CORE_TEST_POSTGRES_URL"];

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
      expect(await on(url, Migrations.run())).toEqual([
        { id: 1, name: "baseline" },
      ]);
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

    test("stamps a database built without the migrator", async () => {
      const url = await freshDatabase("stamp");
      const sql = new SQL(url);
      try {
        for (const statement of baseline) await sql.unsafe(statement);
      } finally {
        await sql.close();
      }
      const expected = await Effect.runPromise(expectedSchema());
      expect(await on(url, Migrations.stamp(expected))).toEqual([
        { id: 1, name: "baseline" },
      ]);
      expect(await on(url, Migrations.plan())).toMatchObject({
        applied: [{ id: 1, name: "baseline" }],
        pending: [],
      });
    });
  });
}
