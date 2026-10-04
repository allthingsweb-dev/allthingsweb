import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { DataSourceError } from "../errors.ts";
import { orDataSourceError } from "../sql.ts";
import {
  calendarTimeZone,
  type FeedEvent,
  locationPlaceholderPattern,
} from "./feed.ts";
import { Luma, type LumaError } from "./luma.ts";
import { venueArchive } from "./venue-archive.ts";

/**
 * Brings `events` in line with the Luma calendar, as the app's hourly sync
 * does (app/src/lib/luma/sync.ts), in one statement.
 *
 * Who owns what, per `events` row:
 * - Luma: name, start and end, and whether it is a draft (cancelled, private
 *   and confidential events are). Each sync writes them.
 * - Luma while it shows a venue: street address, venue name, full address.
 *   When it shows none, the stored venue stays, or, while a field still holds
 *   Luma's placeholder, comes back from the venue archive.
 * - The site, once the event exists: slug, tagline, attendee limit, and every
 *   other column and related row (talks, hosts, photos, recording, flags).
 *   The sync writes slug, tagline and attendee limit for new events only.
 *
 * Nothing is deleted: an event that leaves the feed stays as it is, and a
 * cancelled one becomes a draft. Events without a Luma id are never touched.
 *
 * The feed is read and decoded in full before the database is, and then one
 * INSERT ... ON CONFLICT writes every event: Postgres applies a statement
 * entirely or not at all, so a failing feed or a conflicting slug leaves every
 * row as it was without a transaction, in one round trip (neon-http had no
 * interactive transactions, and none is needed over Hyperdrive either).
 *
 * Written values depend only on the feed, the stored rows and the `Clock`:
 * created_at (new events) and updated_at (every synced event) are the
 * Clock's now, so the same feed on the same rows at the same time writes the
 * same rows. Only a new event's id is generated, by Postgres.
 */

/** A new event's tagline until an organizer writes one. */
export const defaultTagline = "See Luma for event details and registration.";

/** The `events` columns the sync derives from one feed event. */
export interface EventRow {
  readonly lumaEventId: string;
  readonly name: string;
  readonly startDate: DateTime.Utc;
  readonly endDate: DateTime.Utc;
  readonly isDraft: boolean;
  /** Written for new events only. */
  readonly slug: string;
  readonly streetAddress: string | null;
  readonly shortLocation: string | null;
  readonly fullAddress: string | null;
}

/** The columns that hold a venue. */
type VenueColumn = "street_address" | "short_location" | "full_address";

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * A new event's slug: its start date in San Francisco, its name in lowercase
 * ASCII (accents dropped, every other run of characters a dash, at most 100
 * characters), and its Luma id, so no two events share one.
 */
export function eventSlug(
  event: Pick<FeedEvent, "lumaEventId" | "name" | "startDate">,
): string {
  const start = DateTime.toParts(
    DateTime.makeZonedUnsafe(event.startDate, { timeZone: calendarTimeZone }),
  );
  const datePrefix = `${start.year}-${pad(start.month)}-${pad(start.day)}`;
  const name = event.name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
  return `${datePrefix}-${name || "event"}-${event.lumaEventId}`;
}

/** The row `event` asks for. The venue name is the venue up to its first comma. */
export function toEventRow(event: FeedEvent): EventRow {
  const location = event.location;
  return {
    lumaEventId: event.lumaEventId,
    name: event.name,
    startDate: event.startDate,
    endDate: event.endDate,
    isDraft: event.isDraft,
    slug: eventSlug(event),
    streetAddress: location,
    shortLocation: location === null ? null : (location.split(",")[0] ?? null),
    fullAddress: location,
  };
}

/** What a sync did, as the app's cron reports it. */
export interface SyncSummary {
  /** Events in the feed, each written. */
  readonly syncedCount: number;
  /** Of those, the events on the site. */
  readonly publishedCount: number;
  /** Every synced event's stored slug, in feed order: the pages to refresh. */
  readonly slugs: ReadonlyArray<string>;
}

const Written = Schema.Array(
  Schema.Struct({ slug: Schema.String, isDraft: Schema.Boolean }),
);

/** The summary of the rows the statement returned. */
export function summarize(written: typeof Written.Type): SyncSummary {
  return {
    syncedCount: written.length,
    publishedCount: written.filter((row) => !row.isDraft).length,
    slugs: written.map((row) => row.slug),
  };
}

export interface LumaSyncShape {
  /** Reads the calendar and writes it to `events`, all or nothing. */
  readonly run: Effect.Effect<SyncSummary, LumaError | DataSourceError>;
}

const make = Effect.gen(function* () {
  const luma = yield* Luma;
  const sql = yield* SqlClient;

  const archive = JSON.stringify(
    venueArchive.map((venue) => ({
      luma_event_id: venue.lumaEventId,
      street_address: venue.streetAddress,
      short_location: venue.shortLocation,
      full_address: venue.fullAddress,
    })),
  );

  /**
   * A venue field: what Luma shows, else the stored value, unless that is
   * Luma's placeholder, which gives way to the archive (or to NULL).
   */
  const venue = (column: VenueColumn) => {
    const stored = sql.literal(`e.${column}`);
    const archived = sql.literal(`a.${column}`);
    return sql`COALESCE(excluded.${sql.literal(column)}, CASE
      WHEN ${stored} ~* ${locationPlaceholderPattern}
        THEN (SELECT ${archived} FROM archive a WHERE a.luma_event_id = e.luma_event_id)
      ELSE ${stored}
    END)`;
  };

  const write = (rows: ReadonlyArray<EventRow>, now: DateTime.Utc) => {
    const incoming = JSON.stringify(
      rows.map((row, ord) => ({
        ord,
        luma_event_id: row.lumaEventId,
        name: row.name,
        start_date: DateTime.formatIso(row.startDate),
        end_date: DateTime.formatIso(row.endDate),
        is_draft: row.isDraft,
        slug: row.slug,
        street_address: row.streetAddress,
        short_location: row.shortLocation,
        full_address: row.fullAddress,
      })),
    );
    const at = DateTime.formatIso(now);
    return sql`
      WITH incoming AS (
        SELECT * FROM jsonb_to_recordset(${incoming}::jsonb) AS r(
          ord integer, luma_event_id text, name text,
          start_date timestamptz, end_date timestamptz, is_draft boolean,
          slug text, street_address text, short_location text, full_address text)
      ), archive AS (
        SELECT * FROM jsonb_to_recordset(${archive}::jsonb) AS a(
          luma_event_id text, street_address text, short_location text, full_address text)
      )
      INSERT INTO events AS e (
        luma_event_id, name, start_date, end_date, is_draft, slug, tagline,
        attendee_limit, street_address, short_location, full_address,
        created_at, updated_at)
      SELECT luma_event_id, name, start_date, end_date, is_draft, slug,
        ${defaultTagline}, 0, street_address, short_location, full_address,
        ${at}::timestamptz, ${at}::timestamptz
      FROM incoming
      ORDER BY ord
      ON CONFLICT (luma_event_id) DO UPDATE SET
        name = excluded.name,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        is_draft = excluded.is_draft,
        street_address = ${venue("street_address")},
        short_location = ${venue("short_location")},
        full_address = ${venue("full_address")},
        updated_at = excluded.updated_at
      RETURNING e.slug, e.is_draft AS "isDraft"`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Written)),
      orDataSourceError,
    );
  };

  const run = Effect.gen(function* () {
    const events = yield* luma.calendarEvents;
    const now = yield* DateTime.now;
    return summarize(yield* write(events.map(toEventRow), now));
  }).pipe(Effect.withSpan("LumaSync.run"));

  return LumaSync.of({ run });
});

export class LumaSync extends Context.Service<LumaSync, LumaSyncShape>()(
  "allthings/LumaSync",
) {
  /** Needs `Luma` and a `SqlClient`. */
  static readonly layer = Layer.effect(LumaSync, make);
}
