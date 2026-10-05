import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { DataSourceError } from "../errors.ts";
import { orDataSourceError } from "../sql.ts";
import { LumaApi, type LumaApiError } from "./api.ts";
import {
  type Decisions,
  type FetchedEvent,
  type PeoplePlan,
  planPeople,
} from "./people.ts";

/**
 * Imports who hosted each published event, and how many guests it had, from
 * Luma's API (src/luma/api.ts), matching hosts to profiles as
 * src/luma/people.ts plans it.
 *
 * Who owns what:
 * - Luma: event_people rows whose source is 'luma', and each event's
 *   luma_guest_count and luma_checked_in_count. An import replaces an
 *   event's Luma rows with the hosts Luma lists now; an event Luma does not
 *   show (403, 404) or lists no hosts for keeps them. Counts are written for
 *   events our calendar manages only, and only when they change.
 * - The site: event_people rows whose source is 'site' (an MC, say), which
 *   the import never changes, even where Luma lists the same person in the
 *   same role; and everything on a profile but its Luma user id. A profile
 *   an organizer has the import create starts with the host's Luma name and
 *   photo, an empty title and bio, and the member type; from then on it is
 *   the site's.
 *
 * Every published event with a Luma id is asked about, a few at a time. All
 * of Luma's answers are read and decoded before the database is written, in
 * one statement: a failure anywhere (Luma refusing the key, an answer that
 * isn't an event, a decision that cannot be carried out, a profile matched
 * since the plan was made) writes nothing. Without LUMA_API_KEY the import
 * does nothing.
 */

/**
 * Events asked about at once. A run asks about each published event once
 * (32 today), far under the API's 200 requests a minute.
 */
export const concurrency = 4;

/** What the database said the plan was made from. */
const Stored = Schema.Struct({
  events: Schema.Array(
    Schema.Struct({ eventId: Schema.String, lumaEventId: Schema.String }),
  ),
  profiles: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      lumaUserId: Schema.NullOr(Schema.String),
      profileType: Schema.Literals(["organizer", "member"]),
    }),
  ),
});

/** What the write changed, row by row. */
const Written = Schema.Struct({
  linked: Schema.Int,
  created: Schema.Int,
  written: Schema.Int,
  removed: Schema.Int,
  counted: Schema.Int,
});
export type Written = typeof Written.Type;

/** An organizer's decisions about hosts cannot all be carried out. */
export class PeopleDecisionError extends Schema.TaggedError<PeopleDecisionError>()(
  "PeopleDecisionError",
  { problems: Schema.Array(Schema.String) },
) {
  override get message(): string {
    return [
      "Nothing was written; these decisions cannot be carried out:",
      ...this.problems.map((problem) => `  ${problem}`),
    ].join("\n");
  }
}

export type PeopleImport =
  | { readonly _tag: "Skipped"; readonly reason: string }
  | {
      readonly _tag: "Planned";
      /** Published events with a Luma id. */
      readonly asked: number;
      /** Of those, the Luma ids of events Luma does not show us. */
      readonly unavailable: ReadonlyArray<string>;
      readonly plan: PeoplePlan;
      /** What was written; null for a dry run. */
      readonly written: Written | null;
    };

export interface LumaPeopleSyncShape {
  /**
   * Asks Luma, plans the import with the organizer's decisions and, unless
   * `dryRun`, writes it, all or nothing.
   */
  readonly run: (options: {
    readonly dryRun: boolean;
    readonly decisions?: Decisions;
  }) => Effect.Effect<
    PeopleImport,
    LumaApiError | PeopleDecisionError | DataSourceError
  >;
}

const make = Effect.gen(function* () {
  const api = yield* LumaApi;
  const sql = yield* SqlClient;

  const read = sql`
    SELECT
      COALESCE((
        SELECT json_agg(json_build_object('eventId', e.id, 'lumaEventId', e.luma_event_id)
          ORDER BY e.start_date, e.id)
        FROM events e
        WHERE e.is_draft = false AND e.luma_event_id IS NOT NULL
      ), '[]'::json) AS events,
      COALESCE((
        SELECT json_agg(json_build_object('id', p.id, 'name', p.name,
          'lumaUserId', p.luma_user_id, 'profileType', p.profile_type) ORDER BY p.id)
        FROM profiles p
      ), '[]'::json) AS profiles`.pipe(
    Effect.flatMap(([row]) => Schema.decodeUnknownEffect(Stored)(row)),
    orDataSourceError,
  );

  const write = (plan: PeoplePlan, now: DateTime.Utc) => {
    const json = (value: unknown) => JSON.stringify(value);
    const links = json(
      plan.links.map((l) => ({
        profile_id: l.profileId,
        luma_user_id: l.lumaUserId,
      })),
    );
    const created = json(
      plan.newProfiles.map((p, ord) => ({
        ord,
        luma_user_id: p.lumaUserId,
        name: p.name,
        photo_source_url: p.photoSourceUrl,
      })),
    );
    const people = json(
      plan.people.map((p) => ({
        event_id: p.eventId,
        luma_user_id: p.lumaUserId,
        role: p.role,
        position: p.position,
      })),
    );
    const replaced = json(plan.replacedEventIds);
    const counts = json(
      plan.guestCounts.map((c) => ({
        event_id: c.eventId,
        guest_count: c.guestCount,
        checked_in_count: c.checkedInCount,
      })),
    );
    const at = DateTime.formatIso(now);
    // Every sub-statement sees the database as it was before this one, so a
    // profile linked or created here is known only by what its statement
    // returns; `resolved` gathers both with the profiles already linked. A
    // person who resolves to none would be a NULL profile_id, which fails
    // the whole statement rather than dropping the row.
    return sql`
      WITH linked AS (
        UPDATE profiles p
        SET luma_user_id = l.luma_user_id, updated_at = ${at}::timestamptz
        FROM jsonb_to_recordset(${links}::jsonb) AS l(profile_id uuid, luma_user_id text)
        WHERE p.id = l.profile_id AND p.luma_user_id IS NULL
        RETURNING p.id, p.luma_user_id
      ), created AS (
        INSERT INTO profiles (name, title, bio, profile_type, luma_user_id,
          photo_source_url, created_at, updated_at)
        SELECT n.name, '', '', 'member', n.luma_user_id, n.photo_source_url,
          ${at}::timestamptz, ${at}::timestamptz
        FROM jsonb_to_recordset(${created}::jsonb) AS n(
          ord integer, luma_user_id text, name text, photo_source_url text)
        ORDER BY n.ord
        RETURNING id, luma_user_id
      ), resolved AS (
        SELECT id, luma_user_id FROM profiles WHERE luma_user_id IS NOT NULL
        UNION ALL SELECT id, luma_user_id FROM linked
        UNION ALL SELECT id, luma_user_id FROM created
      ), planned AS (
        SELECT pl.event_id, r.id AS profile_id, pl.role, pl.position
        FROM jsonb_to_recordset(${people}::jsonb) AS pl(
          event_id uuid, luma_user_id text, role text, position integer)
        LEFT JOIN resolved r ON r.luma_user_id = pl.luma_user_id
      ), written AS (
        INSERT INTO event_people AS ep (event_id, profile_id, role, position,
          source, created_at, updated_at)
        SELECT event_id, profile_id, role, position, 'luma',
          ${at}::timestamptz, ${at}::timestamptz
        FROM planned
        ON CONFLICT (event_id, profile_id, role) DO UPDATE SET
          position = excluded.position,
          updated_at = excluded.updated_at
        WHERE ep.source = 'luma' AND ep.position <> excluded.position
        RETURNING 1
      ), removed AS (
        DELETE FROM event_people ep
        WHERE ep.source = 'luma'
          AND ep.event_id IN (
            SELECT value::uuid FROM jsonb_array_elements_text(${replaced}::jsonb))
          AND NOT EXISTS (
            SELECT 1 FROM planned pl
            WHERE pl.event_id = ep.event_id AND pl.profile_id = ep.profile_id
              AND pl.role = ep.role)
        RETURNING 1
      ), counted AS (
        UPDATE events e SET
          luma_guest_count = c.guest_count,
          luma_checked_in_count = c.checked_in_count,
          updated_at = ${at}::timestamptz
        FROM jsonb_to_recordset(${counts}::jsonb) AS c(
          event_id uuid, guest_count integer, checked_in_count integer)
        WHERE e.id = c.event_id
          AND (e.luma_guest_count, e.luma_checked_in_count)
            IS DISTINCT FROM (c.guest_count, c.checked_in_count)
        RETURNING 1
      )
      SELECT
        (SELECT count(*) FROM linked)::int AS linked,
        (SELECT count(*) FROM created)::int AS created,
        (SELECT count(*) FROM written)::int AS written,
        (SELECT count(*) FROM removed)::int AS removed,
        (SELECT count(*) FROM counted)::int AS counted`.pipe(
      Effect.flatMap(([row]) => Schema.decodeUnknownEffect(Written)(row)),
      orDataSourceError,
    );
  };

  const run = ({
    dryRun,
    decisions,
  }: {
    readonly dryRun: boolean;
    readonly decisions?: Decisions;
  }) =>
    Option.match(api.eventPeople, {
      onNone: () =>
        Effect.succeed<PeopleImport>({
          _tag: "Skipped",
          reason: "LUMA_API_KEY is not set",
        }),
      onSome: (eventPeople) =>
        Effect.gen(function* () {
          const stored = yield* read;
          const answers = yield* Effect.forEach(
            stored.events,
            (event) =>
              eventPeople(event.lumaEventId).pipe(
                Effect.map((people) => ({ event, people })),
              ),
            { concurrency },
          );
          const fetched: Array<FetchedEvent> = [];
          const unavailable: Array<string> = [];
          for (const { event, people } of answers) {
            if (Option.isSome(people)) {
              fetched.push({ eventId: event.eventId, people: people.value });
            } else {
              unavailable.push(event.lumaEventId);
            }
          }
          const plan = planPeople(fetched, stored.profiles, decisions);
          if (plan.problems.length > 0) {
            return yield* new PeopleDecisionError({ problems: plan.problems });
          }
          const written = dryRun
            ? null
            : yield* write(plan, yield* DateTime.now);
          return {
            _tag: "Planned",
            asked: stored.events.length,
            unavailable,
            plan,
            written,
          } satisfies PeopleImport;
        }),
    }).pipe(Effect.withSpan("LumaPeopleSync.run", { attributes: { dryRun } }));

  return LumaPeopleSync.of({ run });
});

export class LumaPeopleSync extends Context.Service<
  LumaPeopleSync,
  LumaPeopleSyncShape
>()("allthings/LumaPeopleSync") {
  /** Needs `LumaApi` and a `SqlClient`. */
  static readonly layer = Layer.effect(LumaPeopleSync, make);
}
