import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { DataSourceError } from "../errors.ts";
import type { SafeHtml } from "../rich-text.ts";
import { orDataSourceError } from "../sql.ts";
import { LumaApi, type LumaApiError } from "./api.ts";
import { descriptionHtml, descriptionSummary } from "./description.ts";

/**
 * Imports each published event's description from Luma's API
 * (src/luma/api.ts): the calendar feed carries none, only a link to the
 * event's page.
 *
 * Who owns what:
 * - Luma: `events.luma_description` and `events.luma_summary`. Each import
 *   makes them Luma's description as it is now, as sanitized rich text, and
 *   its one-line summary (src/luma/description.ts). Where Luma has none,
 *   the description is empty and the summary NULL; a NULL description means
 *   the event was never asked about. An event Luma does not show us (403,
 *   404) keeps what it has, and is marked asked (an empty description) if
 *   it had nothing, so it holds no place in a capped run.
 * - The site: `events.description` and `events.tagline`, which the import
 *   never reads or writes. Pages show the site's description before Luma's,
 *   and the summary only while the tagline is a placeholder
 *   (src/tagline.ts).
 *
 * Every event written gets the Clock's now as its updated_at, so the
 * sitemap, feeds and caches see the change; an event whose description is
 * already Luma's is not written. All of Luma's answers are read and decoded
 * before the database is written, in one statement: a failure anywhere
 * writes nothing. Without LUMA_API_KEY the import does nothing.
 */

/** Events asked about at once, far under the API's 200 requests a minute. */
export const concurrency = 4;

/** A published event as the import reads it. */
export const StoredEvent = Schema.Struct({
  eventId: Schema.String,
  slug: Schema.String,
  lumaEventId: Schema.String,
  lumaDescription: Schema.NullOr(Schema.String),
  lumaSummary: Schema.NullOr(Schema.String),
});
export type StoredEvent = typeof StoredEvent.Type;

/** Luma's description of one event, as the site stores it. */
export interface Description {
  readonly html: SafeHtml | null;
  readonly summary: string | null;
}

/** What the import changes about one event: its description, before and after. */
export interface DescriptionChange {
  readonly eventId: string;
  readonly slug: string;
  readonly lumaEventId: string;
  readonly before: {
    readonly html: string | null;
    readonly summary: string | null;
  };
  readonly after: Description;
}

/** What Luma's API said about one stored event. */
export interface Fetched {
  readonly event: StoredEvent;
  /** Its description, or None where Luma does not show us the event. */
  readonly description: Option.Option<Description>;
}

/** What is stored for a description: empty where Luma has none. */
export const storedHtml = (description: Description): string =>
  description.html ?? "";

/** The events whose stored description or summary isn't Luma's now. */
export function planDescriptions(
  fetched: ReadonlyArray<Fetched>,
): ReadonlyArray<DescriptionChange> {
  return fetched.flatMap(({ event, description }) => {
    // An event Luma doesn't show us keeps what it has; one never asked
    // about is marked asked, with nothing.
    const after = Option.getOrElse(
      description,
      (): Description => ({ html: null, summary: event.lumaSummary }),
    );
    if (Option.isNone(description) && event.lumaDescription !== null) {
      return [];
    }
    return storedHtml(after) === event.lumaDescription &&
      after.summary === event.lumaSummary
      ? []
      : [
          {
            eventId: event.eventId,
            slug: event.slug,
            lumaEventId: event.lumaEventId,
            before: { html: event.lumaDescription, summary: event.lumaSummary },
            after,
          },
        ];
  });
}

export type DescriptionsImport =
  | { readonly _tag: "Skipped"; readonly reason: string }
  | {
      readonly _tag: "Planned";
      /** Published events with a Luma id that were asked about. */
      readonly asked: number;
      /** Of those, the Luma ids of events Luma does not show us. */
      readonly unavailable: ReadonlyArray<string>;
      readonly changes: ReadonlyArray<DescriptionChange>;
      /** Events written; null for a dry run. */
      readonly written: number | null;
    };

export interface DescriptionsOptions {
  /** Plan only: ask Luma, write nothing. */
  readonly dryRun: boolean;
  /**
   * Ask about at most this many events: those never asked about first,
   * then the latest to end, so one Luma has no description for can't hold
   * a place for good. Every published event otherwise.
   */
  readonly maxEvents?: number;
}

export interface LumaDescriptionsShape {
  /** Asks Luma and, unless `dryRun`, writes what changed, all or nothing. */
  readonly run: (
    options: DescriptionsOptions,
  ) => Effect.Effect<DescriptionsImport, LumaApiError | DataSourceError>;
}

const Written = Schema.Struct({ written: Schema.Int });

/** Luma's description of an event, from the Markdown its editor wrote. */
const describe = (markdown: string | null): Effect.Effect<Description> =>
  Effect.map(descriptionHtml(markdown), (html) => ({
    html,
    summary: descriptionSummary(markdown),
  }));

const make = Effect.gen(function* () {
  const api = yield* LumaApi;
  const sql = yield* SqlClient;

  const read = (maxEvents: number | null) =>
    sql`
      SELECT e.id AS "eventId", e.slug, e.luma_event_id AS "lumaEventId",
        e.luma_description AS "lumaDescription", e.luma_summary AS "lumaSummary"
      FROM events e
      WHERE e.is_draft = false AND e.luma_event_id IS NOT NULL
      ORDER BY e.luma_description IS NULL DESC, e.end_date DESC, e.id
      LIMIT ${maxEvents}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(StoredEvent))),
      orDataSourceError,
    );

  const write = (
    changes: ReadonlyArray<DescriptionChange>,
    now: DateTime.Utc,
  ) => {
    const rows = JSON.stringify(
      changes.map((change) => ({
        event_id: change.eventId,
        luma_description: storedHtml(change.after),
        luma_summary: change.after.summary,
      })),
    );
    const at = DateTime.formatIso(now);
    return sql`
      WITH written AS (
        UPDATE events e SET
          luma_description = c.luma_description,
          luma_summary = c.luma_summary,
          updated_at = ${at}::timestamptz
        FROM jsonb_to_recordset(${rows}::jsonb) AS c(
          event_id uuid, luma_description text, luma_summary text)
        WHERE e.id = c.event_id
          AND (e.luma_description, e.luma_summary)
            IS DISTINCT FROM (c.luma_description, c.luma_summary)
        RETURNING 1
      )
      SELECT count(*)::int AS written FROM written`.pipe(
      Effect.flatMap(([row]) => Schema.decodeUnknownEffect(Written)(row)),
      Effect.map(({ written }) => written),
      orDataSourceError,
    );
  };

  const run = ({ dryRun, maxEvents }: DescriptionsOptions) =>
    Option.match(api.eventDescription, {
      onNone: () =>
        Effect.succeed<DescriptionsImport>({
          _tag: "Skipped",
          reason: "LUMA_API_KEY is not set",
        }),
      onSome: (eventDescription) =>
        Effect.gen(function* () {
          const stored = yield* read(maxEvents ?? null);
          const fetched = yield* Effect.forEach(
            stored,
            (event) =>
              eventDescription(event.lumaEventId).pipe(
                Effect.flatMap(
                  Option.match({
                    onNone: () => Effect.succeedNone,
                    onSome: ({ markdown }) =>
                      Effect.map(describe(markdown), Option.some),
                  }),
                ),
                Effect.map((description): Fetched => ({ event, description })),
              ),
            { concurrency },
          );
          const changes = planDescriptions(fetched);
          const written = dryRun
            ? null
            : changes.length === 0
              ? 0
              : yield* write(changes, yield* DateTime.now);
          return {
            _tag: "Planned",
            asked: stored.length,
            unavailable: fetched
              .filter(({ description }) => Option.isNone(description))
              .map(({ event }) => event.lumaEventId),
            changes,
            written,
          } satisfies DescriptionsImport;
        }),
    }).pipe(
      Effect.withSpan("LumaDescriptions.run", { attributes: { dryRun } }),
    );

  return LumaDescriptions.of({ run });
});

export class LumaDescriptions extends Context.Service<
  LumaDescriptions,
  LumaDescriptionsShape
>()("allthings/LumaDescriptions") {
  /** Needs `LumaApi` and a `SqlClient`. */
  static readonly layer = Layer.effect(LumaDescriptions, make);
}
