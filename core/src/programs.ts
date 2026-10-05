import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { HttpUrl } from "./contract.ts";
import { DataSourceError } from "./errors.ts";
import { EventProgram } from "./rows.ts";

/**
 * What kind of evening each event was (core/backfill/programs.json), each
 * with where that comes from, written in one transaction. A hackathon's
 * `is_hackathon` is written with its program, as the database requires.
 * Events the file doesn't name keep theirs, and the run lists them. A dry
 * run does all of it, reports, and rolls back.
 */

/** An https URL with a domain-name host, as the public contract accepts, and no whitespace. */
const Url = HttpUrl.check(Schema.isPattern(/^https:\/\/\S+$/));

export const Programs = Schema.Struct({
  events: Schema.Array(
    Schema.Struct({
      slug: Schema.String.check(Schema.isNonEmpty()),
      program: EventProgram,
      /** Why, in a few words, where the program isn't plain from the name. */
      note: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
      /** Where it comes from: the event's Luma page, or what an organizer said. */
      sources: Schema.Array(Url).check(Schema.isMinLength(1)),
    }),
  ),
});
export type Programs = typeof Programs.Type;

/** A file that cannot be applied as written; nothing was written. */
export class ProgramsError extends Schema.TaggedError<ProgramsError>()(
  "ProgramsError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

/** What applying did, line by line. */
export interface Applied {
  readonly lines: ReadonlyArray<string>;
}

class RolledBack extends Schema.TaggedError<RolledBack>()("RolledBack", {
  lines: Schema.Array(Schema.String),
}) {}

/** Slugs the file names more than once. */
export function repeatedSlugs(file: Programs): ReadonlyArray<string> {
  const slugs = file.events.map((event) => event.slug);
  return [...new Set(slugs.filter((slug, i) => slugs.indexOf(slug) !== i))];
}

/**
 * Writes `file` in one transaction; with `dryRun`, rolls it back after doing
 * everything. Fails, writing nothing, on a slug no event has, or one the
 * file names twice.
 */
export const applyPrograms = (file: Programs, dryRun: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const fail = (reason: string) => Effect.fail(new ProgramsError({ reason }));
    const repeated = repeatedSlugs(file);
    if (repeated.length > 0) {
      return yield* fail(`Events named twice: ${repeated.join(", ")}`);
    }

    const work = Effect.gen(function* () {
      const lines: Array<string> = [];
      for (const event of file.events) {
        const [row] = yield* sql<{ program: string }>`
          SELECT program FROM events WHERE slug = ${event.slug}`;
        if (row === undefined) {
          return yield* fail(`No event has the slug ${event.slug}`);
        }
        if (row.program === event.program) {
          lines.push(`${event.slug}: ${event.program}, unchanged`);
          continue;
        }
        yield* sql`
          UPDATE events SET program = ${event.program},
            is_hackathon = ${event.program === "hackathon"}, updated_at = now()
          WHERE slug = ${event.slug}`;
        lines.push(`${event.slug}: ${event.program} (was ${row.program})`);
      }
      const named = new Set(file.events.map((event) => event.slug));
      const all = yield* sql<{ slug: string; program: string }>`
        SELECT slug, program FROM events ORDER BY start_date, slug`;
      for (const other of all.filter((e) => !named.has(e.slug))) {
        lines.push(`not in the file: ${other.slug} (${other.program})`);
      }
      if (dryRun) return yield* new RolledBack({ lines });
      return { lines } satisfies Applied;
    });

    return yield* sql.withTransaction(work).pipe(
      Effect.catchTag("RolledBack", (rolledBack) =>
        Effect.succeed<Applied>({
          lines: [...rolledBack.lines, "Dry run: rolled back."],
        }),
      ),
      Effect.catchTag("SqlError", (cause) =>
        Effect.fail(new DataSourceError({ cause })),
      ),
    );
  });
