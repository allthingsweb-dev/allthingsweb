import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { ahead, published, soonestFirst } from "../catalog.ts";
import type { DataSourceError } from "../errors.ts";
import { orDataSourceError } from "../sql.ts";
import { LumaApi, type LumaApiError } from "./api.ts";

/**
 * Whether Luma shows each evening's venue to approved guests only (Luma's
 * "location_visibility": "guests-only"), kept in `events.venue_guests_only`
 * for every public surface to respect: while it is set and the evening is
 * not over, they show only the venue's city (src/catalog.ts,
 * `publicVenue`).
 *
 * Every published evening not over that has a Luma page is asked about,
 * whatever venue is stored: the calendar feed hides a guests-only venue but
 * says nothing of the setting, an organizer's venue (`venue_by_organizer`)
 * is still Luma's to hide, and a venue that was public may be hidden later,
 * or shown. An evening over keeps what was last read; its venue shows
 * again whatever it says. Luma alone decides it: nothing else writes it.
 *
 * Only evenings whose stored setting differs from Luma's are written, each
 * with the Clock's now as its updated_at. All of Luma's answers are read
 * before the database is written, in one statement: a failure anywhere
 * writes nothing. An evening Luma doesn't show us keeps what it has.
 * Without LUMA_API_KEY it does nothing.
 */

/** Evenings asked about at once, far under the API's 200 requests a minute. */
export const concurrency = 4;

/** A published evening not over, with its setting as stored. */
const Ahead = Schema.Struct({
  eventId: Schema.String,
  slug: Schema.String,
  lumaEventId: Schema.String,
  guestsOnly: Schema.Boolean,
});
type Ahead = typeof Ahead.Type;

/** An evening whose setting Luma has changed, and what Luma says now. */
export interface VisibilityChange {
  readonly eventId: string;
  readonly slug: string;
  readonly lumaEventId: string;
  /** Whether Luma now shows the venue to guests only. */
  readonly guestsOnly: boolean;
}

export type VenueVisibility =
  | { readonly _tag: "Skipped"; readonly reason: string }
  | {
      readonly _tag: "Planned";
      /** Published evenings not over, with a Luma page, that were asked about. */
      readonly asked: number;
      /** Of those, the slugs of evenings Luma shows the venue of to guests only. */
      readonly guestsOnly: ReadonlyArray<string>;
      /** Of those asked about, the evenings whose setting changed on Luma. */
      readonly changed: ReadonlyArray<VisibilityChange>;
      /** Of those, the Luma ids of evenings Luma does not show us. */
      readonly unavailable: ReadonlyArray<string>;
      /** Evenings written; null for a dry run. */
      readonly written: number | null;
    };

export interface VenueVisibilityOptions {
  /** Plan only: ask Luma, write nothing. */
  readonly dryRun: boolean;
  /** Ask about at most this many evenings, the soonest first. */
  readonly maxEvents?: number;
}

export interface LumaVenueVisibilityShape {
  /** Asks Luma and, unless `dryRun`, writes what changed, all or nothing. */
  readonly run: (
    options: VenueVisibilityOptions,
  ) => Effect.Effect<VenueVisibility, LumaApiError | DataSourceError>;
}

const Written = Schema.Struct({ written: Schema.Int });

const make = Effect.gen(function* () {
  const api = yield* LumaApi;
  const sql = yield* SqlClient;

  const read = (now: DateTime.Utc, maxEvents: number | null) =>
    sql`
      SELECT e.id AS "eventId", e.slug, e.luma_event_id AS "lumaEventId",
        e.venue_guests_only AS "guestsOnly"
      FROM events e
      WHERE ${published(sql, "e")} AND ${ahead(sql, "e", now)}
        AND e.luma_event_id IS NOT NULL
      ORDER BY ${soonestFirst(sql, "e")}
      LIMIT ${maxEvents}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Ahead))),
      orDataSourceError,
    );

  const write = (
    changes: ReadonlyArray<VisibilityChange>,
    now: DateTime.Utc,
  ) => {
    const rows = JSON.stringify(
      changes.map((change) => ({
        event_id: change.eventId,
        guests_only: change.guestsOnly,
      })),
    );
    return sql`
      WITH written AS (
        UPDATE events e SET
          venue_guests_only = c.guests_only,
          updated_at = ${DateTime.formatIso(now)}::timestamptz
        FROM jsonb_to_recordset(${rows}::jsonb) AS c(
          event_id uuid, guests_only boolean)
        WHERE e.id = c.event_id AND e.venue_guests_only <> c.guests_only
        RETURNING 1
      )
      SELECT count(*)::int AS written FROM written`.pipe(
      Effect.flatMap(([row]) => Schema.decodeUnknownEffect(Written)(row)),
      Effect.map(({ written }) => written),
      orDataSourceError,
    );
  };

  const run = ({ dryRun, maxEvents }: VenueVisibilityOptions) =>
    Option.match(api.eventVenue, {
      onNone: () =>
        Effect.succeed<VenueVisibility>({
          _tag: "Skipped",
          reason: "LUMA_API_KEY is not set",
        }),
      onSome: (eventVenue) =>
        Effect.gen(function* () {
          const evenings = yield* read(yield* DateTime.now, maxEvents ?? null);
          const answers = yield* Effect.forEach(
            evenings,
            (evening: Ahead) =>
              Effect.map(eventVenue(evening.lumaEventId), (venue) => ({
                evening,
                venue,
              })),
            { concurrency },
          );
          const guestsOnly: Array<string> = [];
          const changed: Array<VisibilityChange> = [];
          const unavailable: Array<string> = [];
          for (const { evening, venue } of answers) {
            if (Option.isNone(venue)) {
              unavailable.push(evening.lumaEventId);
              continue;
            }
            if (venue.value.guestsOnly) guestsOnly.push(evening.slug);
            if (venue.value.guestsOnly !== evening.guestsOnly) {
              changed.push({
                eventId: evening.eventId,
                slug: evening.slug,
                lumaEventId: evening.lumaEventId,
                guestsOnly: venue.value.guestsOnly,
              });
            }
          }
          const written = dryRun
            ? null
            : changed.length === 0
              ? 0
              : yield* write(changed, yield* DateTime.now);
          return {
            _tag: "Planned",
            asked: evenings.length,
            guestsOnly,
            changed,
            unavailable,
            written,
          } satisfies VenueVisibility;
        }),
    }).pipe(
      Effect.withSpan("LumaVenueVisibility.run", { attributes: { dryRun } }),
    );

  return LumaVenueVisibility.of({ run });
});

export class LumaVenueVisibility extends Context.Service<
  LumaVenueVisibility,
  LumaVenueVisibilityShape
>()("allthings/LumaVenueVisibility") {
  /** Needs `LumaApi` and a `SqlClient`. */
  static readonly layer = Layer.effect(LumaVenueVisibility, make);
}
