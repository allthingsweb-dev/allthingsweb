import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { HttpUrl } from "./contract.ts";
import { DataSourceError } from "./errors.ts";

/**
 * Evenings we share with our community but don't host
 * (core/backfill/curation.json), each with who organizes it, written in one
 * transaction. An organizer the database lacks is added as a company
 * (`sponsors`) with its sourced site and handles; one it has is used as it
 * is, never overwritten. Events the file doesn't name stay as they are,
 * and the run lists the shared ones among them. A dry run does all of it,
 * reports, and rolls back.
 */

/** An https URL with a domain-name host, as the public contract accepts, and no whitespace. */
const Url = HttpUrl.check(Schema.isPattern(/^https:\/\/\S+$/));
const Sources = Schema.Array(Url).check(Schema.isMinLength(1));
const Text = Schema.String.check(
  Schema.isPattern(/^\S(?:[\s\S]*\S)?$/, {
    message: "must say something, without leading or trailing space",
  }),
);

export const CurationFile = Schema.Struct({
  organizers: Schema.Array(
    Schema.Struct({
      name: Text,
      about: Text,
      website: Url,
      twitterHandle: Schema.NullOr(
        Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_]{1,15}$/)),
      ),
      sources: Sources,
    }),
  ),
  events: Schema.Array(
    Schema.Struct({
      slug: Text,
      /** The organizer's name, as `organizers` or the database has it. */
      organizer: Text,
      sources: Sources,
    }),
  ),
});
export type CurationFile = typeof CurationFile.Type;

/** A file that cannot be applied as written; nothing was written. */
export class CurationError extends Schema.TaggedError<CurationError>()(
  "CurationError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

class RolledBack extends Schema.TaggedError<RolledBack>()("RolledBack", {
  lines: Schema.Array(Schema.String),
}) {}

/** Slugs or organizer names the file names more than once. */
export function repeated(file: CurationFile): ReadonlyArray<string> {
  const twice = (names: ReadonlyArray<string>) =>
    names.filter((name, i) => names.indexOf(name) !== i);
  return [
    ...new Set([
      ...twice(file.events.map((event) => event.slug)),
      ...twice(file.organizers.map((organizer) => organizer.name)),
    ]),
  ];
}

/**
 * Writes `file` in one transaction; with `dryRun`, rolls it back after
 * doing everything. Fails, writing nothing, on a slug no event has, an
 * organizer neither the file nor the database has, or anything named
 * twice.
 */
export const applyCuration = (file: CurationFile, dryRun: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const fail = (reason: string) => Effect.fail(new CurationError({ reason }));
    const twice = repeated(file);
    if (twice.length > 0) {
      return yield* fail(`Named twice: ${twice.join(", ")}`);
    }

    const work = Effect.gen(function* () {
      const lines: Array<string> = [];
      for (const organizer of file.organizers) {
        const added = yield* sql`
          INSERT INTO sponsors (name, about, website_url, twitter_handle, updated_at)
          VALUES (${organizer.name}, ${organizer.about}, ${organizer.website},
            ${organizer.twitterHandle}, now())
          ON CONFLICT (name) DO NOTHING
          RETURNING 1`;
        lines.push(
          `organizer ${organizer.name}: ${added.length === 0 ? "already there, kept as it is" : "added"}`,
        );
      }
      for (const event of file.events) {
        const [row] = yield* sql<{
          id: string;
          curation: string;
          organizer: string | null;
        }>`
          SELECT e.id, e.curation, s.name AS organizer
          FROM events e LEFT JOIN sponsors s ON s.id = e.organized_by
          WHERE e.slug = ${event.slug}`;
        if (row === undefined) {
          return yield* fail(`No event has the slug ${event.slug}`);
        }
        const [organizer] = yield* sql<{ id: string }>`
          SELECT id FROM sponsors WHERE name = ${event.organizer}`;
        if (organizer === undefined) {
          return yield* fail(
            `${event.slug}: no organizer named ${event.organizer}`,
          );
        }
        if (row.curation === "shared" && row.organizer === event.organizer) {
          lines.push(`${event.slug}: shared by ${event.organizer}, unchanged`);
          continue;
        }
        yield* sql`
          UPDATE events SET curation = 'shared', organized_by = ${organizer.id}::uuid,
            updated_at = now()
          WHERE id = ${row.id}::uuid`;
        lines.push(
          `${event.slug}: shared by ${event.organizer} (was ${row.curation === "shared" ? `shared by ${row.organizer ?? "?"}` : "ours"})`,
        );
      }
      const named = new Set(file.events.map((event) => event.slug));
      const shared = yield* sql<{ slug: string }>`
        SELECT slug FROM events WHERE curation = 'shared' ORDER BY start_date, slug`;
      for (const other of shared.filter((e) => !named.has(e.slug))) {
        lines.push(`shared, not in the file: ${other.slug}`);
      }
      if (dryRun) return yield* new RolledBack({ lines });
      return lines;
    });

    return yield* sql.withTransaction(work).pipe(
      Effect.catchTag("RolledBack", (rolledBack) =>
        Effect.succeed([...rolledBack.lines, "Dry run: rolled back."]),
      ),
      Effect.catchTag("SqlError", (cause) =>
        Effect.fail(new DataSourceError({ cause })),
      ),
    );
  });
