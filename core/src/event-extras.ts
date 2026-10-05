import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { HttpUrl } from "./contract.ts";
import { DataSourceError } from "./errors.ts";

/**
 * Schedules and notes for events whose pages say more than their record
 * (core/backfill/event-extras.json), written in one transaction. Each
 * event's schedule and notes in the file are its whole schedule and notes:
 * where the database holds anything else for that event, it is replaced, and
 * where it already holds exactly the file's, nothing is written. Events the
 * file doesn't name are left alone. A dry run does all of it, reports, and
 * rolls back.
 */

/** An https URL with a domain-name host, as the public contract accepts, and no whitespace. */
const Url = HttpUrl.check(Schema.isPattern(/^https:\/\/\S+$/));
/**
 * Text that says something, as written: not blank, and without the leading
 * or trailing space the page would trim away.
 */
const NonEmpty = Schema.String.check(
  Schema.isPattern(/^\S(?:[\s\S]*\S)?$/, {
    message: "must say something, without leading or trailing space",
  }),
);

export const ScheduleItem = Schema.Struct({
  /** As written: "1 - 7 pm", "~7:00 pm". */
  time: NonEmpty,
  title: NonEmpty,
  description: Schema.String,
});

export const Note = Schema.Struct({
  /** The row's label on the page, such as "Awards". */
  label: NonEmpty,
  /** Editor HTML, as talk descriptions are. */
  body: NonEmpty,
});

export const EventExtras = Schema.Struct({
  events: Schema.Array(
    Schema.Struct({
      slug: NonEmpty,
      schedule: Schema.Array(ScheduleItem),
      notes: Schema.Array(Note),
      /** Where each fact comes from, such as the page that said it. */
      sources: Schema.Array(Url).check(Schema.isMinLength(1)),
    }),
  ),
});
export type EventExtras = typeof EventExtras.Type;

/** A file that cannot be applied as written; nothing was written. */
export class EventExtrasError extends Schema.TaggedError<EventExtrasError>()(
  "EventExtrasError",
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

const Stored = Schema.Struct({
  schedule: Schema.Array(ScheduleItem),
  notes: Schema.Array(Note),
});

/** Slugs the file names more than once. */
export function repeatedSlugs(file: EventExtras): ReadonlyArray<string> {
  const slugs = file.events.map((event) => event.slug);
  return [...new Set(slugs.filter((slug, i) => slugs.indexOf(slug) !== i))];
}

/**
 * Writes `file` in one transaction; with `dryRun`, rolls it back after doing
 * everything. Fails, writing nothing, on a slug no event has, or one the file
 * names twice.
 */
export const applyEventExtras = (file: EventExtras, dryRun: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const fail = (reason: string) =>
      Effect.fail(new EventExtrasError({ reason }));
    const repeated = repeatedSlugs(file);
    if (repeated.length > 0) {
      return yield* fail(`Events named twice: ${repeated.join(", ")}`);
    }

    const work = Effect.gen(function* () {
      const lines: Array<string> = [];
      for (const event of file.events) {
        const [row] = yield* sql<{ id: string; stored: unknown }>`
          SELECT ev.id, json_build_object(
            'schedule', COALESCE((
              SELECT json_agg(json_build_object(
                'time', si.time, 'title', si.title, 'description', si.description
              ) ORDER BY si.position)
              FROM event_schedule_items si WHERE si.event_id = ev.id
            ), '[]'::json),
            'notes', COALESCE((
              SELECT json_agg(json_build_object('label', n.label, 'body', n.body)
                ORDER BY n.position)
              FROM event_notes n WHERE n.event_id = ev.id
            ), '[]'::json)
          ) AS stored
          FROM events ev WHERE ev.slug = ${event.slug}`;
        if (row === undefined) {
          return yield* fail(`No event has the slug ${event.slug}`);
        }
        const stored = yield* Schema.decodeUnknownEffect(Stored)(row.stored);
        const wanted = { schedule: event.schedule, notes: event.notes };
        const summary = `${event.schedule.length} schedule items; notes: ${
          event.notes.map((note) => note.label).join(", ") || "none"
        }`;
        if (JSON.stringify(stored) === JSON.stringify(wanted)) {
          lines.push(`${event.slug}: unchanged (${summary})`);
          continue;
        }
        yield* sql`DELETE FROM event_schedule_items WHERE event_id = ${row.id}::uuid`;
        yield* sql`DELETE FROM event_notes WHERE event_id = ${row.id}::uuid`;
        for (const [position, item] of event.schedule.entries()) {
          yield* sql`
            INSERT INTO event_schedule_items (event_id, position, time, title, description, updated_at)
            VALUES (${row.id}::uuid, ${position}, ${item.time}, ${item.title},
              ${item.description}, now())`;
        }
        for (const [position, note] of event.notes.entries()) {
          yield* sql`
            INSERT INTO event_notes (event_id, position, label, body, updated_at)
            VALUES (${row.id}::uuid, ${position}, ${note.label}, ${note.body}, now())`;
        }
        const was = `${stored.schedule.length} schedule items, ${stored.notes.length} notes`;
        lines.push(`${event.slug}: written (${summary}; was ${was})`);
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
      Effect.catchTag(["SqlError", "SchemaError"], (cause) =>
        Effect.fail(new DataSourceError({ cause })),
      ),
    );
  });
