import type { PGlite } from "@electric-sql/pglite";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "../../src/lib/schema";

/**
 * The database the app's tests run against: the drizzle schema's tables,
 * then the code the migrations add that drizzle can't describe, such as
 * the trigger that gives every profile its slug (0029_person_slugs). Taken
 * from the migration files themselves, so a test database never runs
 * without what production runs.
 */
export async function createSchema(client: PGlite): Promise<void> {
  await client.exec("CREATE SCHEMA IF NOT EXISTS neon_auth");
  for (const statement of await generateMigration(
    generateDrizzleJson({}),
    generateDrizzleJson(schema),
  )) {
    await client.exec(statement);
  }
  for (const statement of await databaseCode()) await client.exec(statement);
}

/** Every function and trigger the migrations create, in their order. */
async function databaseCode(): Promise<Array<string>> {
  const directory = new URL("../../migrations/", import.meta.url);
  const files = [
    ...new Bun.Glob("*.sql").scanSync(directory.pathname),
  ].toSorted();
  const code: Array<string> = [];
  for (const file of files) {
    const sql = await Bun.file(new URL(file, directory)).text();
    for (const statement of sql.split("--> statement-breakpoint")) {
      const body = statement.replace(/^(?:\s*--[^\n]*\n)*/, "").trim();
      if (/^CREATE (?:OR REPLACE )?(?:FUNCTION|TRIGGER)\b/i.test(body)) {
        code.push(body.replace(/;\s*$/, ""));
      }
    }
  }
  return code;
}
