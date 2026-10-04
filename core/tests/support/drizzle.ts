import { PGlite } from "@electric-sql/pglite";
import { Schema } from "effect";
import { neonAuth } from "../../migrations/0001_baseline.ts";

/**
 * The app's drizzle migrations (app/migrations), replayed in journal order on
 * an empty database, as the app's history built production. Only the test
 * that holds core's migrations to that history uses it; everything else runs
 * on core's migrations.
 */

const migrations = new URL("../../../app/migrations/", import.meta.url);

const Journal = Schema.Struct({
  entries: Schema.Array(Schema.Struct({ idx: Schema.Int, tag: Schema.String })),
});

/**
 * Statements that cannot replay on an empty database, each with the reason
 * its omission leaves the schema unchanged. Every entry must still match a
 * statement, so the list cannot go stale silently.
 */
const unreplayable: ReadonlyArray<{
  readonly tag: string;
  readonly statement: string;
  readonly reason: string;
}> = [
  {
    tag: "0005_skinny_madelyne_pryor",
    statement: `ALTER TABLE "hack_users" ADD CONSTRAINT "hack_users_hack_id_user_id_pk" PRIMARY KEY("hack_id","user_id");`,
    reason:
      "It adds the key before its column exists; 0009 adds the same key, and 0014 drops the table.",
  },
];

/** drizzle-kit's migrator runs each file as statements split at this marker. */
const breakpoint = "--> statement-breakpoint";

/** The SQL of the migration recorded as `tag` in the journal. */
const readMigration = (tag: string): Promise<string> =>
  Bun.file(new URL(`${tag}.sql`, migrations)).text();

/** An in-process database built by the app's migrations. */
export async function drizzleDatabase(): Promise<PGlite> {
  const db = await PGlite.create();
  try {
    await replay((statement) => db.exec(statement));
  } catch (cause) {
    await db.close();
    throw cause;
  }
  return db;
}

async function replay(
  exec: (statement: string) => Promise<unknown>,
): Promise<void> {
  const journal = Schema.decodeUnknownSync(Journal)(
    await Bun.file(new URL("meta/_journal.json", migrations)).json(),
  );
  const entries = journal.entries.toSorted((a, b) => a.idx - b.idx);

  // Neon Auth created neon_auth.users_sync on production before any migration
  // ran, and 0001 already references it; 0010 then found it (IF NOT EXISTS).
  for (const statement of neonAuth) await exec(statement);

  const skipped = new Set<string>();
  for (const { tag } of entries) {
    for (const part of (await readMigration(tag)).split(breakpoint)) {
      const statement = part.trim();
      if (statement === "") continue;
      const known = unreplayable.find(
        (entry) => entry.tag === tag && entry.statement === statement,
      );
      if (known !== undefined) {
        skipped.add(`${known.tag}: ${known.statement}`);
        continue;
      }
      try {
        await exec(statement);
      } catch (cause) {
        throw new Error(`Migration ${tag} failed at: ${statement}`, { cause });
      }
    }
  }
  for (const entry of unreplayable) {
    if (!skipped.has(`${entry.tag}: ${entry.statement}`)) {
      throw new Error(
        `Migration ${entry.tag} no longer contains the skipped statement; update tests/support/drizzle.ts.`,
      );
    }
  }
}
