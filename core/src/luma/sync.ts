import { Cause, Context, Data, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { DataSourceError } from "../errors.ts";
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
 *   and confidential events are). A sync writes them when Luma changed one.
 * - Luma while it shows a venue: street address, venue name, full address.
 *   When it shows none, the stored venue stays, or, while a field still holds
 *   Luma's placeholder, comes back from the venue archive.
 * - The site, once the event exists: slug, tagline, attendee limit, and every
 *   other column and related row (talks, hosts, photos, recording, flags).
 *   The sync writes slug, tagline and attendee limit for new events only.
 * - The site alone: the topic (all things/<topic>, src/lockup.ts). The sync
 *   never writes it, for new events either: they start without one.
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
 * A stored event is written only when one of Luma's columns would change
 * (venue fields as merged above), so updated_at says when Luma last changed
 * it: a sync of an unchanged calendar writes nothing, and the sitemap, feeds
 * and caches that read updated_at stay put.
 *
 * Written values depend only on the feed, the stored rows and the `Clock`:
 * created_at (new events) and updated_at (every event written) are the
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
  /** Events in the feed, each synced (written or already up to date). */
  readonly syncedCount: number;
  /** Of those, the events created or changed: the rows written. */
  readonly changedCount: number;
  /** Of the synced events, the ones on the site. */
  readonly publishedCount: number;
  /** Every synced event's stored slug, in feed order: the pages to refresh. */
  readonly slugs: ReadonlyArray<string>;
}

/** A feed event as the sync left it. */
export interface SyncedEvent {
  readonly lumaEventId: string;
  readonly slug: string;
  readonly isDraft: boolean;
  /** Whether the sync wrote it. */
  readonly changed: boolean;
}

/**
 * One row per feed event, in feed order. `slug` is NULL for an event the
 * statement neither wrote nor saw: see `write`.
 */
const Synced = Schema.Array(
  Schema.Struct({
    lumaEventId: Schema.String,
    slug: Schema.NullOr(Schema.String),
    isDraft: Schema.Boolean,
    changed: Schema.Boolean,
  }),
);

const Stored = Schema.Array(
  Schema.Struct({ lumaEventId: Schema.String, slug: Schema.String }),
);

const StoredFields = Schema.Array(
  Schema.Struct({
    lumaEventId: Schema.String,
    fields: Schema.Record(Schema.String, Schema.Unknown),
  }),
);

/**
 * `synced` with the slugs of the events the statement did not see taken
 * from `stored`, read afterwards; undefined while one is still missing.
 */
export function fillUnseen(
  synced: typeof Synced.Type,
  stored: typeof Stored.Type,
): ReadonlyArray<SyncedEvent> | undefined {
  const slugs = new Map(stored.map((row) => [row.lumaEventId, row.slug]));
  const filled: Array<SyncedEvent> = [];
  for (const row of synced) {
    const slug = row.slug ?? slugs.get(row.lumaEventId);
    if (slug === undefined) return undefined;
    filled.push({ ...row, slug });
  }
  return filled;
}

/** The summary of the synced events, one per feed event. */
export function summarize(synced: ReadonlyArray<SyncedEvent>): SyncSummary {
  return {
    syncedCount: synced.length,
    changedCount: synced.filter((row) => row.changed).length,
    publishedCount: synced.filter((row) => !row.isDraft).length,
    slugs: synced.map((row) => row.slug),
  };
}

/** Luma's columns of one stored event, as JSON: name, dates, draft flag, venue. */
export type EventFields = Readonly<Record<string, unknown>>;

/** What a sync would write, found by writing it and rolling back. */
export interface SyncRehearsal extends SyncSummary {
  /** Events the feed has and `events` doesn't, as they would be inserted. */
  readonly created: ReadonlyArray<{
    readonly lumaEventId: string;
    readonly slug: string;
    readonly fields: EventFields;
  }>;
  /** Stored events Luma changed: each changed column, before and after. */
  readonly updated: ReadonlyArray<{
    readonly lumaEventId: string;
    readonly slug: string;
    readonly changes: Readonly<
      Record<string, { readonly before: unknown; readonly after: unknown }>
    >;
  }>;
}

/**
 * The rehearsal of a sync from what its statement returned (`synced`) and
 * Luma's columns of the events it touched, read before and after it in the
 * same transaction.
 */
export function rehearsalOf(
  synced: ReadonlyArray<SyncedEvent>,
  before: ReadonlyMap<string, EventFields>,
  after: ReadonlyMap<string, EventFields>,
): SyncRehearsal {
  const created: Array<SyncRehearsal["created"][number]> = [];
  const updated: Array<SyncRehearsal["updated"][number]> = [];
  for (const row of synced) {
    if (!row.changed) continue;
    const was = before.get(row.lumaEventId);
    const is = after.get(row.lumaEventId) ?? {};
    if (was === undefined) {
      created.push({
        lumaEventId: row.lumaEventId,
        slug: row.slug,
        fields: is,
      });
      continue;
    }
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const column of new Set([...Object.keys(was), ...Object.keys(is)])) {
      if (JSON.stringify(was[column]) !== JSON.stringify(is[column])) {
        changes[column] = { before: was[column], after: is[column] };
      }
    }
    updated.push({ lumaEventId: row.lumaEventId, slug: row.slug, changes });
  }
  return {
    ...summarize(synced),
    created,
    updated,
  };
}

/** Carries a rehearsal out of the transaction it rolls back. */
export class Rehearsed extends Data.TaggedError("Rehearsed")<{
  readonly rehearsal: SyncRehearsal;
}> {}

/**
 * The rehearsal a rolled-back transaction carried out as its failure.
 * A rollback that fails is a defect beside that failure: then nothing says
 * the database was left as it was, so the rehearsal fails, defect and all,
 * instead of reporting.
 */
export const concludeRehearsal = (
  transaction: Effect.Effect<never, Rehearsed | SqlError | DataSourceError>,
): Effect.Effect<SyncRehearsal, DataSourceError> =>
  Effect.catchCause(transaction, (cause) =>
    Cause.hasDies(cause)
      ? // Cause.map, unlike Effect.mapError, keeps the defect.
        Effect.failCause(
          Cause.map(cause, (error) =>
            error._tag === "DataSourceError"
              ? error
              : new DataSourceError({ cause: error }),
          ),
        )
      : Effect.failCause(cause).pipe(
          Effect.catchTag("Rehearsed", ({ rehearsal }) =>
            Effect.succeed(rehearsal),
          ),
          Effect.catchTag("SqlError", (error) =>
            Effect.fail(new DataSourceError({ cause: error })),
          ),
        ),
  );

export interface LumaSyncShape {
  /**
   * Reads the calendar and writes what changed to `events`, all or
   * nothing.
   */
  readonly run: Effect.Effect<SyncSummary, LumaError | DataSourceError>;
  /**
   * The dry run: reads the calendar and runs `run`'s very statement inside
   * a transaction that always rolls back, so it reports exactly what `run`
   * would write now (every created event, and every changed column of the
   * others) and leaves `events` as it was. Its rows are locked only for
   * the moment between the statement and the rollback, and it reads one
   * snapshot throughout (REPEATABLE READ), so an edit committed meanwhile
   * never shows as a change the sync makes.
   */
  readonly rehearse: Effect.Effect<SyncRehearsal, LumaError | DataSourceError>;
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
    // One row per feed event, in feed order. Its draft flag is the feed's:
    // the statement inserts it, writes it, or skips the event because the
    // committed row (which ON CONFLICT checks) already holds it. Its slug,
    // which syncs never change, is the written row's, else the stored one as
    // the statement's snapshot has it (a slug edited on the site meanwhile
    // shows on the next run). Only an event another sync inserted after the
    // snapshot is in neither: its slug comes back NULL, for `readStored`.
    return sql`
      WITH incoming AS (
        SELECT * FROM jsonb_to_recordset(${incoming}::jsonb) AS r(
          ord integer, luma_event_id text, name text,
          start_date timestamptz, end_date timestamptz, is_draft boolean,
          slug text, street_address text, short_location text, full_address text)
      ), archive AS (
        SELECT * FROM jsonb_to_recordset(${archive}::jsonb) AS a(
          luma_event_id text, street_address text, short_location text, full_address text)
      ), written AS (
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
        WHERE (e.name, e.start_date, e.end_date, e.is_draft,
            e.street_address, e.short_location, e.full_address)
          IS DISTINCT FROM (excluded.name, excluded.start_date, excluded.end_date,
            excluded.is_draft, ${venue("street_address")},
            ${venue("short_location")}, ${venue("full_address")})
        RETURNING e.luma_event_id, e.slug
      )
      SELECT i.luma_event_id AS "lumaEventId",
        COALESCE(w.slug, stored.slug) AS slug,
        i.is_draft AS "isDraft",
        w.luma_event_id IS NOT NULL AS changed
      FROM incoming i
      LEFT JOIN written w ON w.luma_event_id = i.luma_event_id
      LEFT JOIN events stored ON stored.luma_event_id = i.luma_event_id
      ORDER BY i.ord`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Synced)),
      orDataSourceError,
    );
  };

  /** The stored slugs of these events, as committed now. */
  const readStored = (lumaEventIds: ReadonlyArray<string>) =>
    sql`
      SELECT luma_event_id AS "lumaEventId", slug
      FROM events
      WHERE luma_event_id IN (
        SELECT jsonb_array_elements_text(${JSON.stringify(lumaEventIds)}::jsonb))`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Stored)),
      orDataSourceError,
    );

  /** `synced` with every stored slug. */
  const withSlugs = (synced: typeof Synced.Type) =>
    Effect.gen(function* () {
      // Only after an overlapping sync: a read, so the write stays one
      // statement and the summary still lists every stored slug.
      const unseen = synced
        .filter((row) => row.slug === null)
        .map((row) => row.lumaEventId);
      const stored = unseen.length === 0 ? [] : yield* readStored(unseen);
      const filled = fillUnseen(synced, stored);
      if (filled === undefined) {
        return yield* new DataSourceError({
          cause: new Error("A synced Luma event is no longer stored"),
        });
      }
      return filled;
    });

  const run = Effect.gen(function* () {
    const events = yield* luma.calendarEvents;
    const now = yield* DateTime.now;
    const synced = yield* write(events.map(toEventRow), now);
    return summarize(yield* withSlugs(synced));
  }).pipe(Effect.withSpan("LumaSync.run"));

  /** Luma's columns of these events as stored, by Luma id. */
  const readFields = (lumaEventIds: ReadonlyArray<string>) =>
    sql`
      SELECT luma_event_id AS "lumaEventId", jsonb_build_object(
        'name', name, 'startDate', start_date, 'endDate', end_date,
        'isDraft', is_draft, 'streetAddress', street_address,
        'shortLocation', short_location, 'fullAddress', full_address) AS fields
      FROM events
      WHERE luma_event_id IN (
        SELECT jsonb_array_elements_text(${JSON.stringify(lumaEventIds)}::jsonb))`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(StoredFields)),
      Effect.map(
        (rows) =>
          new Map<string, EventFields>(
            rows.map((row) => [row.lumaEventId, row.fields]),
          ),
      ),
      orDataSourceError,
    );

  const rehearse = Effect.gen(function* () {
    const events = yield* luma.calendarEvents;
    const now = yield* DateTime.now;
    const rows = events.map(toEventRow);
    return yield* Effect.gen(function* () {
      // One snapshot for both reads and the statement, so an edit committed
      // meanwhile can't show as a change the sync makes. It takes no locks
      // beyond the statement's own; a row edited meanwhile that the
      // statement would write fails the rehearsal, which can simply run again.
      yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`.pipe(
        orDataSourceError,
      );
      const before = yield* readFields(rows.map((row) => row.lumaEventId));
      const synced = yield* withSlugs(yield* write(rows, now));
      const after = yield* readFields(
        synced.filter((row) => row.changed).map((row) => row.lumaEventId),
      );
      return yield* new Rehearsed({
        rehearsal: rehearsalOf(synced, before, after),
      });
    }).pipe(sql.withTransaction, concludeRehearsal);
  }).pipe(Effect.withSpan("LumaSync.rehearse"));

  return LumaSync.of({ run, rehearse });
});

export class LumaSync extends Context.Service<LumaSync, LumaSyncShape>()(
  "allthings/LumaSync",
) {
  /** Needs `Luma` and a `SqlClient`. */
  static readonly layer = Layer.effect(LumaSync, make);
}
