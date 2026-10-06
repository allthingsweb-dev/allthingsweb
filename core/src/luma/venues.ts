import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { DataSourceError } from "../errors.ts";
import { orDataSourceError } from "../sql.ts";
import { LumaApi, type LumaApiError } from "./api.ts";
import { locationPlaceholderPattern } from "./feed.ts";
import { type EventRow, venueColumns } from "./sync.ts";

/**
 * Fills in the venues Luma's calendar feed hides. While an event's venue is
 * shown to guests only (Luma's "location_visibility": "guests-only"), the
 * feed's LOCATION is the event's own page and its DESCRIPTION says "Check
 * event page for more details", so the sync (src/luma/sync.ts) has no venue
 * to store: an event it creates then has none, and keeps none. Luma's API,
 * asked with our calendar's key, gives the address all the same
 * (`geo_address_json`).
 *
 * Who owns what: the venue stays the feed's (src/luma/sync.ts), and the
 * site's where an organizer wrote one. This only fills in a published
 * event's venue while it is missing: no street or full address, or only
 * Luma's placeholder. It writes the address the way the sync writes one the
 * feed shows (`venueColumns`), field by field where each is still missing,
 * so a venue name an organizer typed stays. A venue written meanwhile is
 * never replaced: the write checks again that it is missing.
 *
 * Every event written gets the Clock's now as its updated_at. All of Luma's
 * answers are read before the database is written, in one statement: a
 * failure anywhere writes nothing. Without LUMA_API_KEY it does nothing.
 */

/** Events asked about at once, far under the API's 200 requests a minute. */
export const concurrency = 4;

/** A published event whose venue is missing, as the fill reads it. */
const Unplaced = Schema.Struct({
  eventId: Schema.String,
  slug: Schema.String,
  lumaEventId: Schema.String,
});
type Unplaced = typeof Unplaced.Type;

/** What the fill writes for one event. */
export interface VenueFill {
  readonly eventId: string;
  readonly slug: string;
  readonly lumaEventId: string;
  /** Whether Luma shows the venue to guests only: why the feed had none. */
  readonly guestsOnly: boolean;
  readonly venue: Pick<
    EventRow,
    "streetAddress" | "shortLocation" | "fullAddress"
  >;
}

export type VenuesFill =
  | { readonly _tag: "Skipped"; readonly reason: string }
  | {
      readonly _tag: "Planned";
      /** Published events without a venue that were asked about. */
      readonly asked: number;
      /** Their venues, from Luma's API. */
      readonly filled: ReadonlyArray<VenueFill>;
      /** Of those asked about, the slugs of events Luma has no address for. */
      readonly unplaced: ReadonlyArray<string>;
      /** Of those, the Luma ids of events Luma does not show us. */
      readonly unavailable: ReadonlyArray<string>;
      /** Events written; null for a dry run. */
      readonly written: number | null;
    };

export interface VenuesOptions {
  /** Plan only: ask Luma, write nothing. */
  readonly dryRun: boolean;
  /** Ask about at most this many events, the latest to start first. */
  readonly maxEvents?: number;
}

export interface LumaVenuesShape {
  /** Asks Luma and, unless `dryRun`, writes the venues it has, all or nothing. */
  readonly run: (
    options: VenuesOptions,
  ) => Effect.Effect<VenuesFill, LumaApiError | DataSourceError>;
}

const Written = Schema.Struct({ written: Schema.Int });

const make = Effect.gen(function* () {
  const api = yield* LumaApi;
  const sql = yield* SqlClient;

  /** Whether a venue field says nothing: empty, or Luma's placeholder. */
  const isMissing = (value: ReturnType<typeof sql.literal>) =>
    sql`(${value} IS NULL OR btrim(${value}) = ''
      OR ${value} ~* ${locationPlaceholderPattern})`;
  /** Whether column `column` of `events e` says nothing. */
  const missing = (column: "street_address" | "full_address") =>
    isMissing(sql.literal(`e.${column}`));

  const read = (maxEvents: number | null) =>
    sql`
      SELECT e.id AS "eventId", e.slug, e.luma_event_id AS "lumaEventId"
      FROM events e
      WHERE e.is_draft = false AND e.luma_event_id IS NOT NULL
        AND ${missing("street_address")} AND ${missing("full_address")}
      ORDER BY e.start_date DESC, e.id
      LIMIT ${maxEvents}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Unplaced))),
      orDataSourceError,
    );

  const write = (fills: ReadonlyArray<VenueFill>, now: DateTime.Utc) => {
    const rows = JSON.stringify(
      fills.map((fill) => ({
        event_id: fill.eventId,
        street_address: fill.venue.streetAddress,
        short_location: fill.venue.shortLocation,
        full_address: fill.venue.fullAddress,
      })),
    );
    const at = DateTime.formatIso(now);
    /** `column` as stored, unless it says nothing: then Luma's. */
    const fill = (
      column: "street_address" | "short_location" | "full_address",
    ) => {
      const stored = sql.literal(`e.${column}`);
      return sql`CASE WHEN ${isMissing(stored)}
        THEN ${sql.literal(`c.${column}`)} ELSE ${stored} END`;
    };
    return sql`
      WITH written AS (
        UPDATE events e SET
          street_address = ${fill("street_address")},
          short_location = ${fill("short_location")},
          full_address = ${fill("full_address")},
          updated_at = ${at}::timestamptz
        FROM jsonb_to_recordset(${rows}::jsonb) AS c(
          event_id uuid, street_address text, short_location text,
          full_address text)
        WHERE e.id = c.event_id
          AND ${missing("street_address")} AND ${missing("full_address")}
        RETURNING 1
      )
      SELECT count(*)::int AS written FROM written`.pipe(
      Effect.flatMap(([row]) => Schema.decodeUnknownEffect(Written)(row)),
      Effect.map(({ written }) => written),
      orDataSourceError,
    );
  };

  const run = ({ dryRun, maxEvents }: VenuesOptions) =>
    Option.match(api.eventVenue, {
      onNone: () =>
        Effect.succeed<VenuesFill>({
          _tag: "Skipped",
          reason: "LUMA_API_KEY is not set",
        }),
      onSome: (eventVenue) =>
        Effect.gen(function* () {
          const unplaced = yield* read(maxEvents ?? null);
          const answers = yield* Effect.forEach(
            unplaced,
            (event: Unplaced) =>
              Effect.map(eventVenue(event.lumaEventId), (venue) => ({
                event,
                venue,
              })),
            { concurrency },
          );
          const filled: Array<VenueFill> = [];
          const unavailable: Array<string> = [];
          const nowhere: Array<string> = [];
          for (const { event, venue } of answers) {
            if (Option.isNone(venue)) {
              unavailable.push(event.lumaEventId);
            } else if (venue.value.location === null) {
              nowhere.push(event.slug);
            } else {
              filled.push({
                ...event,
                guestsOnly: venue.value.guestsOnly,
                venue: venueColumns(venue.value.location),
              });
            }
          }
          const written = dryRun
            ? null
            : filled.length === 0
              ? 0
              : yield* write(filled, yield* DateTime.now);
          return {
            _tag: "Planned",
            asked: unplaced.length,
            filled,
            unplaced: nowhere,
            unavailable,
            written,
          } satisfies VenuesFill;
        }),
    }).pipe(Effect.withSpan("LumaVenues.run", { attributes: { dryRun } }));

  return LumaVenues.of({ run });
});

export class LumaVenues extends Context.Service<LumaVenues, LumaVenuesShape>()(
  "allthings/LumaVenues",
) {
  /** Needs `LumaApi` and a `SqlClient`. */
  static readonly layer = Layer.effect(LumaVenues, make);
}
