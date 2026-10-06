import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Schema } from "effect";
import { Command } from "effect/cli";
import { SqlClient } from "effect/sql/SqlClient";
import { migrations } from "../migrations/index.ts";
import * as Database from "../src/database.ts";
import {
  type Claim,
  checkMigrations,
  fileOf,
  type MigrationRef,
  migrationOfPath,
} from "../src/migration-guard.ts";
import { table } from "../src/migrator.ts";

/**
 * Fails when this checkout's core migrations would collide
 * (src/migration-guard.ts): when they don't extend production's applied
 * record, in order, or when this pull request adds a migration under a
 * number another open pull request adds too. CI runs it on every pull
 * request and on main (.github/workflows/migrations.yaml).
 *
 *   bun run migration-guard
 *
 * From the environment, never .env files:
 * - DATABASE_URL: production as site_reader, which may read the record
 *   (effect_sql.migrations) and nothing else of the migrator's. It is only
 *   read. Without it the run fails, unless NO_PRODUCTION_OK=true (a pull
 *   request from a fork gets no secrets), when the other check still runs.
 * - GITHUB_REPOSITORY, GITHUB_TOKEN: to list the open pull requests and the
 *   files each adds.
 * - PR_NUMBER: this pull request; unset on main, which adds nothing.
 */

const env = (name: string) => {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
};

const Recorded = Schema.Array(
  Schema.Struct({ migration_id: Schema.Number, name: Schema.String }),
);

/** Production's record of applied migrations, read and never written. */
const appliedInProduction = Effect.gen(function* () {
  const sql = yield* SqlClient;
  const rows = yield* sql`
    SELECT migration_id, name FROM ${sql(table)} ORDER BY migration_id`
    .withoutTransform;
  return (yield* Schema.decodeUnknownEffect(Recorded)(rows)).map(
    ({ migration_id, name }): MigrationRef => ({ id: migration_id, name }),
  );
}).pipe(Effect.provide(Database.layer));

/** GitHub's REST API, every page of a list. */
const githubList = <A>(path: string) =>
  Effect.tryPromise({
    try: async () => {
      const repository = env("GITHUB_REPOSITORY");
      const token = env("GITHUB_TOKEN");
      if (repository === undefined || token === undefined) {
        throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required");
      }
      const items: Array<A> = [];
      for (let page = 1; ; page++) {
        const separator = path.includes("?") ? "&" : "?";
        const response = await fetch(
          `https://api.github.com/repos/${repository}/${path}${separator}per_page=100&page=${page}`,
          {
            headers: {
              accept: "application/vnd.github+json",
              authorization: `Bearer ${token}`,
              "x-github-api-version": "2022-11-28",
            },
          },
        );
        if (!response.ok) {
          throw new Error(`GitHub answered ${response.status} for ${path}`);
        }
        const batch = (await response.json()) as Array<A>;
        items.push(...batch);
        if (batch.length < 100) return items;
      }
    },
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  });

/** The core migrations pull request `pr` adds (or renames to). */
const addedBy = (pr: number) =>
  githubList<{ filename: string; status: string }>(`pulls/${pr}/files`).pipe(
    Effect.map((files) =>
      files.flatMap((file) => {
        const migration =
          file.status === "added" || file.status === "renamed"
            ? migrationOfPath(file.filename)
            : null;
        return migration === null ? [] : [migration];
      }),
    ),
  );

const command = Command.make("migration-guard", {}, () =>
  Effect.gen(function* () {
    // In id order, as production's record is, whatever the index's key order.
    const local = Object.keys(migrations)
      .map((key): MigrationRef => {
        const [number, ...rest] = key.split("_");
        return { id: Number(number), name: rest.join("_") };
      })
      .toSorted((a, b) => a.id - b.id);

    const production = env("DATABASE_URL") !== undefined;
    if (!production && env("NO_PRODUCTION_OK") !== "true") {
      return yield* Effect.fail(
        new Error(
          "DATABASE_URL (production as site_reader) is required to read the applied migrations",
        ),
      );
    }
    const applied = production ? yield* appliedInProduction : [];
    if (!production) {
      yield* Console.log(
        "No production URL (a pull request from a fork): checking open pull requests only.",
      );
    }

    const own = env("PR_NUMBER");
    const ownNumber = own === undefined ? null : Number(own);
    const added = ownNumber === null ? [] : yield* addedBy(ownNumber);
    const open = yield* githubList<{ number: number }>("pulls?state=open");
    const claims: Array<Claim> = [];
    for (const { number } of open) {
      if (number === ownNumber) continue;
      for (const migration of yield* addedBy(number)) {
        claims.push({ ...migration, pr: number });
      }
    }

    yield* Console.log(
      [
        `Production has applied: ${applied.length === 0 ? "(not read)" : `${applied.length}, up to ${fileOf(applied.at(-1) ?? { id: 0, name: "" })}`}`,
        `This branch has: ${local.length}, up to ${fileOf(local.at(-1) ?? { id: 0, name: "" })}`,
        `This pull request adds: ${added.length === 0 ? "none" : added.map(fileOf).join(", ")}`,
        `Other open pull requests add: ${claims.length === 0 ? "none" : claims.map((c) => `${fileOf(c)} (#${c.pr})`).join(", ")}`,
      ].join("\n"),
    );

    const problems = checkMigrations({ local, applied, added, claims });
    if (problems.length > 0) {
      return yield* Effect.fail(
        new Error(
          ["Migration numbers collide:", ...problems.map((p) => `- ${p}`)].join(
            "\n",
          ),
        ),
      );
    }
    return yield* Console.log("No migration numbers collide.");
  }),
).pipe(
  Command.withDescription(
    "Fail if core migrations don't extend production's, or take another open pull request's number.",
  ),
);

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
