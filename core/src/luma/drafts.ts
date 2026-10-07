import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { DataSourceError } from "../errors.ts";
import { orDataSourceError } from "../sql.ts";
import { LumaApi, type LumaApiError, type LumaEventDetails } from "./api.ts";
import { defaultTagline } from "../tagline.ts";
import { eventSlug, venueColumns } from "./sync.ts";

/**
 * Keeps the drafts we know in line with Luma. Luma's calendar feed carries
 * no private event, so once the sync has stored an event as a draft (it
 * went private, or was made private), the feed never says what became of
 * it: its row keeps the name and times it had. Luma's API, asked with our
 * calendar's key, still answers for it.
 *
 * Who owns what is the sync's (src/luma/sync.ts): Luma owns the name, the
 * times and, while Luma has one and the organizers set none
 * (`venue_by_organizer`), the venue; this writes those, and only where
 * they differ. Whether it is a draft stays the feed's: an event Luma now
 * shows publicly comes back in the feed, and the sync publishes it, so
 * here it is only reported. An event Luma no longer shows us (403, or 404
 * once cancelled) is left as it is.
 *
 * Read-only on Luma. Every event written gets the Clock's now as its
 * updated_at, and the write checks again that the row is still a draft.
 * All of Luma's answers are read before the database is written, in one
 * statement: a failure anywhere writes nothing. Without LUMA_API_KEY it
 * does nothing.
 */

/** Events asked about at once, far under the API's 200 requests a minute. */
export const concurrency = 4;

const StoredDraft = Schema.Struct({
  eventId: Schema.String,
  slug: Schema.String,
  lumaEventId: Schema.String,
  name: Schema.String,
  startDate: Schema.DateTimeUtcFromDate,
  endDate: Schema.DateTimeUtcFromDate,
  venueByOrganizer: Schema.Boolean,
  streetAddress: Schema.NullOr(Schema.String),
  shortLocation: Schema.NullOr(Schema.String),
  fullAddress: Schema.NullOr(Schema.String),
});
export type StoredDraft = typeof StoredDraft.Type;

/** One column a refresh would change: before and after. */
export interface DraftChange {
  readonly column:
    | "name"
    | "start_date"
    | "end_date"
    | "street_address"
    | "short_location"
    | "full_address";
  readonly before: string | null;
  readonly after: string | null;
}

/** What the refresh does to one draft. */
export interface DraftRefresh {
  readonly eventId: string;
  readonly slug: string;
  readonly lumaEventId: string;
  readonly changes: ReadonlyArray<DraftChange>;
}

export type DraftsRefresh =
  | { readonly _tag: "Skipped"; readonly reason: string }
  | {
      readonly _tag: "Planned";
      /** Drafts asked about. */
      readonly asked: number;
      /** Those Luma's answer changes. */
      readonly refreshed: ReadonlyArray<DraftRefresh>;
      /** Of those asked about, the slugs Luma now shows publicly: the feed's to publish. */
      readonly public: ReadonlyArray<string>;
      /** Of those, the Luma ids of events Luma does not show us. */
      readonly unavailable: ReadonlyArray<string>;
      /** Events written; null for a dry run. */
      readonly written: number | null;
    };

export interface DraftsOptions {
  /** Plan only: ask Luma, write nothing. */
  readonly dryRun: boolean;
  /** Ask about at most this many drafts, the soonest to start first. */
  readonly maxEvents?: number;
}

/** Why a private event wasn't stored as a draft; nothing was written. */
export class DraftNotAdded extends Schema.TaggedError<DraftNotAdded>()(
  "DraftNotAdded",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

/** A private Luma event stored, or to be stored, as a draft evening. */
export interface DraftAdded {
  readonly lumaEventId: string;
  readonly slug: string;
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly venue: string | null;
  /** False on a dry run: nothing was written. */
  readonly written: boolean;
}

export interface LumaDraftsShape {
  /** Asks Luma and, unless `dryRun`, writes what changed, all or nothing. */
  readonly run: (
    options: DraftsOptions,
  ) => Effect.Effect<DraftsRefresh, LumaApiError | DataSourceError>;
  /**
   * Stores the private event `lumaEventId` as a draft evening, as the sync
   * would store it had the feed carried it: its name, times and venue from
   * Luma's API, and the sync's slug and placeholder tagline. The calendar
   * feed carries no private event, so an evening the studio makes private
   * (`bun run luma create`) reaches the database, readiness and the draft
   * preview only this way. A public event is the feed's, and one already
   * stored is refused. Unless `dryRun`.
   */
  readonly add: (
    lumaEventId: string,
    options: { readonly dryRun: boolean },
  ) => Effect.Effect<
    DraftAdded,
    DraftNotAdded | LumaApiError | DataSourceError
  >;
}

const iso = (instant: DateTime.Utc): string => DateTime.formatIso(instant);

/**
 * The columns Luma's `details` change on the draft `stored`, in a fixed
 * order: a pure function, so the same answer on the same row always plans
 * the same.
 */
export function draftChanges(
  stored: StoredDraft,
  details: LumaEventDetails,
): ReadonlyArray<DraftChange> {
  const changes: Array<DraftChange> = [];
  const compare = (
    column: DraftChange["column"],
    before: string | null,
    after: string | null,
  ) => {
    if (before !== after) changes.push({ column, before, after });
  };
  compare("name", stored.name, details.name);
  compare("start_date", iso(stored.startDate), iso(details.startDate));
  if (details.endDate !== null) {
    compare("end_date", iso(stored.endDate), iso(details.endDate));
  }
  if (details.location !== null && !stored.venueByOrganizer) {
    const venue = venueColumns(details.location);
    compare("street_address", stored.streetAddress, venue.streetAddress);
    compare("short_location", stored.shortLocation, venue.shortLocation);
    compare("full_address", stored.fullAddress, venue.fullAddress);
  }
  return changes;
}

const Written = Schema.Struct({ written: Schema.Int });

const make = Effect.gen(function* () {
  const api = yield* LumaApi;
  const sql = yield* SqlClient;

  const read = (maxEvents: number | null) =>
    sql`
      SELECT e.id AS "eventId", e.slug, e.luma_event_id AS "lumaEventId",
        e.name, e.start_date AS "startDate", e.end_date AS "endDate",
        e.venue_by_organizer AS "venueByOrganizer",
        e.street_address AS "streetAddress",
        e.short_location AS "shortLocation", e.full_address AS "fullAddress"
      FROM events e
      WHERE e.is_draft = true AND e.luma_event_id IS NOT NULL
      ORDER BY e.start_date, e.id
      LIMIT ${maxEvents}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(StoredDraft))),
      orDataSourceError,
    );

  const write = (refreshed: ReadonlyArray<DraftRefresh>, now: DateTime.Utc) => {
    const rows = JSON.stringify(
      refreshed.map(({ eventId, changes }) => ({
        event_id: eventId,
        ...Object.fromEntries(
          changes.map(({ column, after }) => [column, after]),
        ),
      })),
    );
    const at = DateTime.formatIso(now);
    /**
     * Luma's value for `column` where the refresh changes it, else the
     * stored one: draftChanges only ever plans a value, never null.
     */
    const fresh = (column: DraftChange["column"]) =>
      sql.literal(`COALESCE(c.${column}, e.${column})`);
    /**
     * A venue column as `fresh` would write it, unless the organizers set
     * the venue since it was read: then it stays theirs.
     */
    const venue = (
      column: "street_address" | "short_location" | "full_address",
    ) =>
      sql.literal(
        `CASE WHEN e.venue_by_organizer THEN e.${column} ELSE COALESCE(c.${column}, e.${column}) END`,
      );
    return sql`
      WITH written AS (
        UPDATE events e SET
          name = ${fresh("name")},
          start_date = ${fresh("start_date")},
          end_date = ${fresh("end_date")},
          street_address = ${venue("street_address")},
          short_location = ${venue("short_location")},
          full_address = ${venue("full_address")},
          updated_at = ${at}::timestamptz
        FROM jsonb_to_recordset(${rows}::jsonb) AS c(
          event_id uuid, name text, start_date timestamptz,
          end_date timestamptz, street_address text, short_location text,
          full_address text)
        WHERE e.id = c.event_id AND e.is_draft = true
        RETURNING 1
      )
      SELECT count(*)::int AS written FROM written`.pipe(
      Effect.flatMap(([row]) => Schema.decodeUnknownEffect(Written)(row)),
      Effect.map(({ written }) => written),
      orDataSourceError,
    );
  };

  const run = ({ dryRun, maxEvents }: DraftsOptions) =>
    Option.match(api.eventDetails, {
      onNone: () =>
        Effect.succeed<DraftsRefresh>({
          _tag: "Skipped",
          reason: "LUMA_API_KEY is not set",
        }),
      onSome: (eventDetails) =>
        Effect.gen(function* () {
          const drafts = yield* read(maxEvents ?? null);
          const answers = yield* Effect.forEach(
            drafts,
            (draft) =>
              Effect.map(eventDetails(draft.lumaEventId), (details) => ({
                draft,
                details,
              })),
            { concurrency },
          );
          const refreshed: Array<DraftRefresh> = [];
          const shownPublicly: Array<string> = [];
          const unavailable: Array<string> = [];
          for (const { draft, details } of answers) {
            if (Option.isNone(details)) {
              unavailable.push(draft.lumaEventId);
              continue;
            }
            if (details.value.visibility === "public") {
              shownPublicly.push(draft.slug);
            }
            const changes = draftChanges(draft, details.value);
            if (changes.length > 0) {
              refreshed.push({
                eventId: draft.eventId,
                slug: draft.slug,
                lumaEventId: draft.lumaEventId,
                changes,
              });
            }
          }
          const written = dryRun
            ? null
            : refreshed.length === 0
              ? 0
              : yield* write(refreshed, yield* DateTime.now);
          return {
            _tag: "Planned",
            asked: drafts.length,
            refreshed,
            public: shownPublicly,
            unavailable,
            written,
          } satisfies DraftsRefresh;
        }),
    }).pipe(Effect.withSpan("LumaDrafts.run", { attributes: { dryRun } }));

  const refuse = (reason: string) => Effect.fail(new DraftNotAdded({ reason }));

  const storedSlug = (lumaEventId: string) =>
    sql`SELECT slug FROM events WHERE luma_event_id = ${lumaEventId}`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ slug: Schema.String })),
        ),
      ),
      Effect.map(([row]) => Option.fromNullishOr(row?.slug)),
      orDataSourceError,
    );

  const add = (lumaEventId: string, { dryRun }: { readonly dryRun: boolean }) =>
    Effect.gen(function* () {
      if (Option.isNone(api.eventDetails)) {
        return yield* refuse(
          "LUMA_API_KEY is not set: Luma can't be asked about the event.",
        );
      }
      const details = yield* api.eventDetails.value(lumaEventId);
      if (Option.isNone(details)) {
        return yield* refuse(
          `Luma doesn't show us ${lumaEventId}, or gives it no name or start.`,
        );
      }
      const event = details.value;
      if (event.visibility !== "private") {
        return yield* refuse(
          `${event.name} is ${event.visibility} on Luma: the calendar feed brings it in. Only a private event is added as a draft.`,
        );
      }
      if (event.endDate === null) {
        return yield* refuse(
          `${event.name} has no end on Luma: give it one first.`,
        );
      }
      const already = yield* storedSlug(lumaEventId);
      if (Option.isSome(already)) {
        return yield* refuse(
          `${event.name} is already stored, as ${already.value}.`,
        );
      }
      const slug = eventSlug(event);
      // Another evening holding the slug is refused here too, so a dry run
      // says what the write would.
      const taken =
        yield* sql`SELECT 1 AS taken FROM events WHERE slug = ${slug}`.pipe(
          orDataSourceError,
        );
      if (taken.length > 0) {
        return yield* refuse(
          `Another evening has the slug ${slug}: nothing was written.`,
        );
      }
      const venue = venueColumns(event.location);
      const added = {
        lumaEventId,
        slug,
        name: event.name,
        startDate: DateTime.formatIso(event.startDate),
        endDate: DateTime.formatIso(event.endDate),
        venue: venue.shortLocation,
        written: false,
      } satisfies DraftAdded;
      if (dryRun) return added;
      const at = DateTime.formatIso(yield* DateTime.now);
      // The sync's own insert for a new event, as a draft. A row stored
      // meanwhile (by a sync, or another add), or another evening holding
      // its slug, is left as it is: no unique column is overwritten.
      const inserted = yield* sql`
        INSERT INTO events (
          luma_event_id, name, start_date, end_date, is_draft, slug, tagline,
          attendee_limit, street_address, short_location, full_address,
          created_at, updated_at)
        VALUES (${lumaEventId}, ${event.name}, ${added.startDate}::timestamptz,
          ${added.endDate}::timestamptz, true, ${slug}, ${defaultTagline}, 0,
          ${venue.streetAddress}, ${venue.shortLocation}, ${venue.fullAddress},
          ${at}::timestamptz, ${at}::timestamptz)
        ON CONFLICT DO NOTHING
        RETURNING slug`.pipe(orDataSourceError);
      if (inserted.length === 0) {
        return yield* refuse(
          `${event.name} was stored meanwhile, or another evening has the slug ${slug}: nothing was written.`,
        );
      }
      return { ...added, written: true };
    }).pipe(Effect.withSpan("LumaDrafts.add", { attributes: { dryRun } }));

  return LumaDrafts.of({ run, add });
});

export class LumaDrafts extends Context.Service<LumaDrafts, LumaDraftsShape>()(
  "allthings/LumaDrafts",
) {
  /** Needs `LumaApi` and a `SqlClient`. */
  static readonly layer = Layer.effect(LumaDrafts, make);
}

/** A stored, or would-be, draft as text for an organizer. */
export function formatAdded(added: DraftAdded): string {
  return [
    `${added.written ? "Stored" : "Would store (dry run: nothing written)"} ${added.lumaEventId} as the draft ${added.slug}:`,
    `  ${added.name}`,
    `  ${added.startDate} → ${added.endDate}`,
    `  ${added.venue ?? "no venue yet"}`,
  ].join("\n");
}

/** "1 draft", "2 drafts". */
const count = (n: number, noun: string): string =>
  `${n} ${noun}${n === 1 ? "" : "s"}`;

/** The refresh as text for an organizer: each draft it changes, and how. */
export function formatDrafts(result: DraftsRefresh): string {
  if (result._tag === "Skipped") return `Skipped: ${result.reason}.`;
  const lines = [
    `Asked Luma about ${count(result.asked, "draft")}; ${result.unavailable.length} not shown to us${
      result.unavailable.length === 0
        ? ""
        : `: ${result.unavailable.join(", ")}`
    }.`,
    result.written === null
      ? `Would refresh ${count(result.refreshed.length, "draft")} (dry run: nothing written).`
      : `Refreshed ${count(result.written, "draft")}.`,
    ...result.refreshed.flatMap((draft) => [
      `  ${draft.slug}:`,
      ...draft.changes.map(
        (change) =>
          `    ${change.column}: ${change.before ?? "∅"} → ${change.after ?? "∅"}`,
      ),
    ]),
  ];
  if (result.public.length > 0) {
    lines.push(
      `Public on Luma now, for the feed to publish: ${result.public.join(", ")}`,
    );
  }
  return lines.join("\n");
}
