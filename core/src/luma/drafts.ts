import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { DataSourceError } from "../errors.ts";
import { orDataSourceError } from "../sql.ts";
import { actorFor, currentActor, logDraft } from "../planning/draft-log.ts";
import { LumaApi, type LumaApiError, type LumaEventDetails } from "./api.ts";
import { defaultTagline } from "../tagline.ts";
import { descriptionHtml, descriptionSummary } from "./description.ts";
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
 * once cancelled) is left as it is: the refresh names it, and `forget`
 * removes its draft once Luma confirms it is gone.
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
  lumaDescription: Schema.NullOr(Schema.String),
  lumaSummary: Schema.NullOr(Schema.String),
});
export type StoredDraft = typeof StoredDraft.Type;

/**
 * A draft's description as Luma has it, as the import of published ones
 * stores it (src/luma/descriptions.ts): sanitized rich text ("" for none)
 * and its one-line summary.
 */
export interface DraftDescription {
  readonly html: string;
  readonly summary: string | null;
}

/** One column a refresh would change: before and after. */
export interface DraftChange {
  readonly column:
    | "name"
    | "start_date"
    | "end_date"
    | "street_address"
    | "short_location"
    | "full_address"
    | "luma_description"
    | "luma_summary";
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

/** Why a draft wasn't forgotten; nothing was written. */
export class DraftNotForgotten extends Schema.TaggedError<DraftNotForgotten>()(
  "DraftNotForgotten",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

/** Rows, by table, as planning.forget_draft counts them. */
const Rows = Schema.Record(Schema.String, Schema.Int);

/** planning.forget_draft's answer (migrations/0030_forget_draft.ts); null for no such evening. */
const ForgetAnswer = Schema.NullOr(
  Schema.Struct({
    blocks: Rows,
    deletes: Rows,
    keeps: Rows,
    forgotten: Schema.Boolean,
  }),
);

/** A draft whose Luma event is gone, forgotten, or to be forgotten. */
export interface DraftForgotten {
  readonly slug: string;
  readonly lumaEventId: string;
  readonly name: string;
  /** Rows deleted, or to be, by table: its private lineup and talks, and the evening. */
  readonly deletes: Readonly<Record<string, number>>;
  /** Rows kept, by table, that no foreign key holds to it: its log and notes. */
  readonly keeps: Readonly<Record<string, number>>;
  /** False on a dry run: nothing was written. */
  readonly written: boolean;
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
  /**
   * Removes the stored draft `draft` (its slug, or its Luma id), once
   * Luma's API confirms its event is gone (403, or 404) and the database
   * that nothing keeps it (planning.forget_draft,
   * migrations/0030_forget_draft.ts): it is still a draft, was never
   * claimed for a publish, and nothing public, no idea and no
   * collaboration points at it. Its private lineup and talks go with it;
   * its log and notes stay. Luma is asked before the database is written,
   * and the delete and its line in the log are one transaction. Unless
   * `dryRun`.
   */
  readonly forget: (
    draft: string,
    options: { readonly dryRun: boolean },
  ) => Effect.Effect<
    DraftForgotten,
    DraftNotForgotten | LumaApiError | DataSourceError
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
  description?: DraftDescription,
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
  if (description !== undefined) {
    compare("luma_description", stored.lumaDescription, description.html);
    compare("luma_summary", stored.lumaSummary, description.summary);
  }
  return changes;
}

const Written = Schema.Struct({ written: Schema.Int });

/** An evening, as forgetting its draft reads it. */
const StoredEvening = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  lumaEventId: Schema.NullOr(Schema.String),
  isDraft: Schema.Boolean,
});

/** Luma's description of a draft, as the import of published ones stores it. */
const describeDraft = (
  markdown: string | null,
): Effect.Effect<DraftDescription> =>
  Effect.map(descriptionHtml(markdown), (html) => ({
    html: html ?? "",
    summary: descriptionSummary(markdown),
  }));

const make = Effect.gen(function* () {
  const api = yield* LumaApi;
  const sql = yield* SqlClient;

  const read = (maxEvents: number | null) =>
    sql`
      SELECT e.id AS "eventId", e.slug, e.luma_event_id AS "lumaEventId",
        e.name, e.start_date AS "startDate", e.end_date AS "endDate",
        e.venue_by_organizer AS "venueByOrganizer",
        e.street_address AS "streetAddress",
        e.short_location AS "shortLocation", e.full_address AS "fullAddress",
        e.luma_description AS "lumaDescription", e.luma_summary AS "lumaSummary"
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
        summary_planned: changes.some(
          ({ column }) => column === "luma_summary",
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
          luma_description = COALESCE(c.luma_description, e.luma_description),
          -- A summary Luma's description no longer has is planned as null:
          -- summary_planned tells it from a summary that doesn't change.
          luma_summary = CASE WHEN c.summary_planned THEN c.luma_summary
            ELSE e.luma_summary END,
          updated_at = ${at}::timestamptz
        FROM jsonb_to_recordset(${rows}::jsonb) AS c(
          event_id uuid, name text, start_date timestamptz,
          end_date timestamptz, street_address text, short_location text,
          full_address text, luma_description text, luma_summary text,
          summary_planned boolean)
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
              Effect.flatMap(eventDetails(draft.lumaEventId), (details) =>
                Effect.map(
                  Option.isSome(details)
                    ? describeDraft(details.value.description)
                    : Effect.succeed(undefined),
                  (description) => ({ draft, details, description }),
                ),
              ),
            { concurrency },
          );
          const refreshed: Array<DraftRefresh> = [];
          const shownPublicly: Array<string> = [];
          const unavailable: Array<string> = [];
          for (const { draft, details, description } of answers) {
            if (Option.isNone(details)) {
              unavailable.push(draft.lumaEventId);
              continue;
            }
            if (details.value.visibility === "public") {
              shownPublicly.push(draft.slug);
            }
            const changes = draftChanges(draft, details.value, description);
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
      const description = yield* describeDraft(event.description);
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
      yield* actorFor(refuse);
      const at = DateTime.formatIso(yield* DateTime.now);
      // The sync's own insert for a new event, as a draft. A row stored
      // meanwhile (by a sync, or another add), or another evening holding
      // its slug, is left as it is: no unique column is overwritten.
      const inserted = yield* sql
        .withTransaction(
          Effect.tap(
            sql`
        INSERT INTO events (
          luma_event_id, name, start_date, end_date, is_draft, slug, tagline,
          attendee_limit, street_address, short_location, full_address,
          luma_description, luma_summary, created_at, updated_at)
        VALUES (${lumaEventId}, ${event.name}, ${added.startDate}::timestamptz,
          ${added.endDate}::timestamptz, true, ${slug}, ${defaultTagline}, 0,
          ${venue.streetAddress}, ${venue.shortLocation}, ${venue.fullAddress},
          ${description.html}, ${description.summary},
          ${at}::timestamptz, ${at}::timestamptz)
        ON CONFLICT DO NOTHING
        RETURNING slug`,
            (rows) =>
              rows.length === 0
                ? Effect.void
                : logDraft({
                    event: { lumaEventId },
                    command: "luma:drafts --add",
                    summary: `Stored its private Luma event as a draft evening, ${slug}.`,
                    payload: {
                      lumaEventId,
                      slug,
                      startDate: added.startDate,
                      endDate: added.endDate,
                    },
                  }),
          ),
        )
        .pipe(
          Effect.provideService(SqlClient, sql),
          Effect.catchTag("ActorRequired", (missing) => refuse(missing.reason)),
          Effect.catchTag("SqlError", (cause) =>
            Effect.fail(new DataSourceError({ cause })),
          ),
        );
      if (inserted.length === 0) {
        return yield* refuse(
          `${event.name} was stored meanwhile, or another evening has the slug ${slug}: nothing was written.`,
        );
      }
      return { ...added, written: true };
    }).pipe(Effect.withSpan("LumaDrafts.add", { attributes: { dryRun } }));

  const notForgotten = (reason: string) =>
    Effect.fail(new DraftNotForgotten({ reason }));

  /** planning.forget_draft on `eventId`: what keeps it, what it deletes and keeps. */
  const forgetDraft = (eventId: string, forget: boolean) =>
    sql`SELECT planning.forget_draft(${eventId}::uuid, ${forget}) AS answer`.pipe(
      Effect.flatMap(([row]) =>
        Schema.decodeUnknownEffect(ForgetAnswer)(row?.["answer"] ?? null),
      ),
    );

  /** What keeps a draft, as its refusal says it: "public.event_talks (1), …". */
  const keptBy = (slug: string, blocks: Readonly<Record<string, number>>) =>
    `${slug} is kept by ${Object.entries(blocks)
      .toSorted(([a], [b]) => (a < b ? -1 : 1))
      .map(([what, n]) => `${what} (${n})`)
      .join(", ")}: nothing was written.`;

  const forget = (draft: string, { dryRun }: { readonly dryRun: boolean }) =>
    Effect.gen(function* () {
      if (Option.isNone(api.eventVenue)) {
        return yield* notForgotten(
          "LUMA_API_KEY is not set: Luma can't confirm the event is gone.",
        );
      }
      const [stored] = yield* sql`
        SELECT id, slug, name, luma_event_id AS "lumaEventId", is_draft AS "isDraft"
        FROM events WHERE slug = ${draft} OR luma_event_id = ${draft}`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(StoredEvening))),
        orDataSourceError,
      );
      if (stored === undefined) {
        return yield* notForgotten(`No evening is stored as ${draft}.`);
      }
      if (!stored.isDraft) {
        return yield* notForgotten(
          `${stored.slug} is published: only a draft is forgotten.`,
        );
      }
      const lumaEventId = stored.lumaEventId;
      if (lumaEventId === null) {
        return yield* notForgotten(
          `${stored.slug} has no Luma event, so Luma can't confirm it is gone.`,
        );
      }
      // Asked for its venue, not its details: those are None for an event
      // without a name or start too, the venue only for a 403 or 404.
      const shown = yield* api.eventVenue.value(lumaEventId);
      if (Option.isSome(shown)) {
        return yield* notForgotten(
          `Luma still has ${lumaEventId}: only a draft whose Luma event is gone (403 or 404) is forgotten.`,
        );
      }
      const removed = `${stored.slug} was removed meanwhile: nothing was written.`;
      const planned = yield* forgetDraft(stored.id, false).pipe(
        orDataSourceError,
      );
      if (planned === null) return yield* notForgotten(removed);
      if (Object.keys(planned.blocks).length > 0) {
        return yield* notForgotten(keptBy(stored.slug, planned.blocks));
      }
      const forgotten = {
        slug: stored.slug,
        lumaEventId,
        name: stored.name,
        deletes: planned.deletes,
        keeps: planned.keeps,
        written: false,
      } satisfies DraftForgotten;
      if (dryRun) return forgotten;
      // Asked first, so a missing actor writes nothing at all.
      yield* currentActor.pipe(
        Effect.catchTag("ActorRequired", (missing) =>
          notForgotten(missing.reason),
        ),
      );
      // Locked and counted again in the transaction, then its line in the
      // log while the evening is there for it to name, then the delete.
      const done = yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const locked = yield* forgetDraft(stored.id, false);
            if (locked === null) return yield* notForgotten(removed);
            if (Object.keys(locked.blocks).length > 0) {
              return yield* notForgotten(keptBy(stored.slug, locked.blocks));
            }
            yield* logDraft({
              event: { id: stored.id },
              command: "luma:drafts --forget",
              summary: `Forgot the draft ${stored.slug}: Luma no longer has ${lumaEventId}.`,
              payload: {
                lumaEventId,
                slug: stored.slug,
                deletes: locked.deletes,
              },
            });
            const answer = yield* forgetDraft(stored.id, true);
            if (answer?.forgotten !== true) {
              return yield* notForgotten(
                `${stored.slug} wasn't forgotten: nothing was written.`,
              );
            }
            return answer;
          }),
        )
        .pipe(
          Effect.provideService(SqlClient, sql),
          Effect.catchTag("ActorRequired", (missing) =>
            notForgotten(missing.reason),
          ),
          Effect.catchTag(["SqlError", "SchemaError"], (cause) =>
            Effect.fail(new DataSourceError({ cause })),
          ),
        );
      return {
        ...forgotten,
        deletes: done.deletes,
        keeps: done.keeps,
        written: true,
      } satisfies DraftForgotten;
    }).pipe(Effect.withSpan("LumaDrafts.forget", { attributes: { dryRun } }));

  return LumaDrafts.of({ run, add, forget });
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

/** Rows by table, by name, as "planning.draft_people 3, public.events 1"; "nothing" for none. */
const rows = (counts: Readonly<Record<string, number>>): string => {
  const listed = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .toSorted(([a], [b]) => (a < b ? -1 : 1))
    .map(([table, n]) => `${table} ${n}`);
  return listed.length === 0 ? "nothing" : listed.join(", ");
};

/** A forgotten, or would-be forgotten, draft as text for an organizer. */
export function formatForgotten(forgotten: DraftForgotten): string {
  return [
    `${forgotten.written ? "Forgot" : "Would forget (dry run: nothing written)"} the draft ${forgotten.slug} (${forgotten.name}): Luma no longer has ${forgotten.lumaEventId}.`,
    `  ${forgotten.written ? "deleted" : "would delete"}: ${rows(forgotten.deletes)}`,
    `  ${forgotten.written ? "kept" : "would keep"}, with no foreign key to it: ${rows(forgotten.keeps)}`,
  ].join("\n");
}

/** A description's size, rather than all of it. */
const size = (html: string | null): string =>
  html === null ? "∅" : html === "" ? "none" : `${html.length} chars`;

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
      ...draft.changes.map((change) =>
        change.column === "luma_description"
          ? `    luma_description: ${size(change.before)} → ${size(change.after)}`
          : `    ${change.column}: ${change.before ?? "∅"} → ${change.after ?? "∅"}`,
      ),
    ]),
  ];
  for (const lumaEventId of result.unavailable) {
    lines.push(
      `  If Luma deleted ${lumaEventId}, forget its draft: bun run luma:drafts --forget ${lumaEventId} --dry-run`,
    );
  }
  if (result.public.length > 0) {
    lines.push(
      `Public on Luma now, for the feed to publish: ${result.public.join(", ")}`,
    );
  }
  return lines.join("\n");
}
