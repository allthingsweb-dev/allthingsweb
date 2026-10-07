import { DateTime, Order } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import type * as Statement from "effect/sql/Statement";
import type * as Contract from "./contract.ts";
import type * as Rows from "./rows.ts";

/**
 * The catalog: which evenings there are, in what order, and whether each
 * is ahead or over, each stated once (README, "One catalog"). A public read
 * builds its statement from these fragments rather than writing its own
 * `is_draft`, `end_date`, `curation` or ordering of evenings;
 * tests/catalog-guard.test.ts holds the code to that.
 *
 * A fragment names the events table by the alias its statement gives it,
 * one of a few constants, never input.
 */

/**
 * How statements alias the events table (`e`, `ev`), or a subquery of
 * it that keeps its columns' names (`x`, `y`).
 */
export type EventAlias = "e" | "ev" | "x" | "y";

/** An instant as a statement's parameter. */
const instant = (now: DateTime.Utc | Date): Date =>
  now instanceof Date ? now : DateTime.toDateUtc(now);

const column = (sql: SqlClient, e: EventAlias, name: string) =>
  sql.literal(`${e}.${name}`);

/** The evenings anyone may see: every one but drafts. */
export const published = (sql: SqlClient, e: EventAlias): Statement.Fragment =>
  sql`${column(sql, e, "is_draft")} = false`;

/**
 * Drafts: what the organizers' preview reads, never a public route
 * (web/src/preview/).
 */
export const drafts = (sql: SqlClient, e: EventAlias): Statement.Fragment =>
  sql`${column(sql, e, "is_draft")} = true`;

/**
 * Evenings not over at `now`: upcoming, or live through their end, as
 * {@link eventStatus} has it.
 */
export const ahead = (
  sql: SqlClient,
  e: EventAlias,
  now: DateTime.Utc | Date,
): Statement.Fragment => sql`${column(sql, e, "end_date")} >= ${instant(now)}`;

/** Evenings over at `now`: past, as {@link eventStatus} has it. */
export const ended = (
  sql: SqlClient,
  e: EventAlias,
  now: DateTime.Utc | Date,
): Statement.Fragment => sql`${column(sql, e, "end_date")} < ${instant(now)}`;

/** Our own evenings, not those we share. */
export const ours = (sql: SqlClient, e: EventAlias): Statement.Fragment =>
  sql`${column(sql, e, "curation")} = 'ours'`;

/**
 * Soonest start first, for an ORDER BY. Ids break ties, so no order is
 * left to the planner.
 */
export const soonestFirst = (
  sql: SqlClient,
  e: EventAlias,
): Statement.Fragment =>
  sql`${column(sql, e, "start_date")}, ${column(sql, e, "id")}`;

/** Latest start first, for an ORDER BY; ids break ties. */
export const latestFirst = (
  sql: SqlClient,
  e: EventAlias,
): Statement.Fragment =>
  sql`${column(sql, e, "start_date")} DESC, ${column(sql, e, "id")}`;

/**
 * Upcoming before the start, live from the start through the end, then
 * past: {@link ahead} and {@link ended} in code.
 */
export function eventStatus(
  event: Pick<Rows.Event, "startDate" | "endDate">,
  now: DateTime.Utc,
): Contract.EventStatus {
  if (DateTime.isLessThan(now, event.startDate)) return "upcoming";
  if (DateTime.isLessThanOrEqualTo(now, event.endDate)) return "live";
  return "past";
}

/**
 * Soonest start first, in code. Evenings that start together keep the
 * order they came in, which {@link soonestFirst} and {@link latestFirst}
 * set by id.
 */
export const byStart: Order.Order<Pick<Rows.Event, "startDate">> =
  Order.mapInput(DateTime.Order, (event) => event.startDate);

/*
 * An evening's lineup: its talks in running order, each talk's speakers in
 * the order they were attached, its hosts in the order they were attached,
 * and its people by role (organizers, co-hosts, the MC), then their
 * position. Every surface that lists them lists them so.
 *
 * The orders are SQL over fixed aliases: `et` (event_talks) and `t`
 * (talks); `ts` (talk_speakers) and `p` (profiles); `es` (event_sponsors)
 * and `s` (sponsors); `ep` (event_people) and `p`. The builders below join
 * them so; code that writes its own join uses these names.
 */

/** Talks in running order: by position, then as attached. */
export const talkOrder = "et.position NULLS LAST, et.created_at, t.id";

/** A talk's speakers, as attached. */
export const speakerOrder = "ts.created_at, p.id";

/** An evening's hosts, as attached. */
export const hostOrder = "es.created_at, s.id";

/** An evening's people: by role, then their position in it. */
export const peopleOrder =
  "array_position(ARRAY['organizer', 'co-host', 'mc'], ep.role), ep.position, ep.created_at, p.id";

/**
 * The talks of the evening aliased `e`, as a JSON array in running order.
 * Each is a JSON object of `talk` (key, value pairs over `t` and `et`) and
 * `speakers`: each speaker as `speaker` (an expression over `p` and `ts`),
 * in {@link speakerOrder}.
 */
export const talksOf = (
  sql: SqlClient,
  e: EventAlias,
  fields: {
    readonly talk: Statement.Fragment;
    readonly speaker: Statement.Fragment;
  },
): Statement.Fragment => sql`COALESCE((
    SELECT json_agg(json_build_object(
      ${fields.talk},
      'speakers', COALESCE((
        SELECT json_agg(${fields.speaker} ORDER BY ${sql.literal(speakerOrder)})
        FROM talk_speakers ts
        JOIN profiles p ON p.id = ts.speaker_id
        WHERE ts.talk_id = t.id
      ), '[]'::json)
    ) ORDER BY ${sql.literal(talkOrder)})
    FROM event_talks et
    JOIN talks t ON t.id = et.talk_id
    WHERE et.event_id = ${column(sql, e, "id")}
  ), '[]'::json)`;

/**
 * The hosts of the evening aliased `e`, each as `host` (an expression over
 * `s` and `es`), as a JSON array in {@link hostOrder}.
 */
export const hostsOf = (
  sql: SqlClient,
  e: EventAlias,
  host: Statement.Fragment,
): Statement.Fragment => sql`COALESCE((
    SELECT json_agg(${host} ORDER BY ${sql.literal(hostOrder)})
    FROM event_sponsors es
    JOIN sponsors s ON s.id = es.sponsor_id
    WHERE es.event_id = ${column(sql, e, "id")}
  ), '[]'::json)`;

/**
 * The people of the evening aliased `e`, each as `person` (an expression
 * over `p` and `ep`), as a JSON array in {@link peopleOrder}.
 */
export const peopleOf = (
  sql: SqlClient,
  e: EventAlias,
  person: Statement.Fragment,
): Statement.Fragment => sql`COALESCE((
    SELECT json_agg(${person} ORDER BY ${sql.literal(peopleOrder)})
    FROM event_people ep
    JOIN profiles p ON p.id = ep.profile_id
    WHERE ep.event_id = ${column(sql, e, "id")}
  ), '[]'::json)`;

/*
 * A person's appearances: their talks and their parts (organizer, co-host,
 * MC) at published evenings, as one relation each. Who counts where is a
 * scope of it: whose evenings, and when.
 */

/** Whose evenings an appearance counts at: ours, or any we list. */
export type Whose = "ours" | "any";

/**
 * When an appearance counts: at any evening, or once its evening is over
 * at an instant (`ended`, as {@link eventStatus} has it). The speakers
 * list counts a talk from its evening's last instant, while it is still
 * live (`endedOrEnding`), until it reads `ended` like the rest.
 */
export type When =
  | "any"
  | { readonly ended: DateTime.Utc | Date }
  | { readonly endedOrEnding: DateTime.Utc | Date };

const scoped = (
  sql: SqlClient,
  scope: { readonly whose: Whose; readonly when: When },
): Statement.Fragment => {
  const when = scope.when;
  return sql.and([
    published(sql, "e"),
    ...(scope.whose === "ours" ? [ours(sql, "e")] : []),
    ...(when === "any"
      ? []
      : "ended" in when
        ? [ended(sql, "e", when.ended)]
        : [sql`e.end_date <= ${instant(when.endedOrEnding)}`]),
  ]);
};

/**
 * Talks given, one row per speaker, talk and evening, as a subquery:
 * `profile_id`, `role` (speaking or moderating), `talk_id`, `position` and
 * `listed_at` (where the talk is in its evening's running order), and the
 * evening's `event_id` and `start_date`. Join talks, profiles and events by
 * id for the rest.
 */
export const talkAppearances = (
  sql: SqlClient,
  scope: { readonly whose: Whose; readonly when: When },
): Statement.Fragment => sql`(
    SELECT ts.speaker_id AS profile_id, ts.role, ts.talk_id,
      et.position, et.created_at AS listed_at,
      e.id AS event_id, e.start_date
    FROM talk_speakers ts
    JOIN event_talks et ON et.talk_id = ts.talk_id
    JOIN events e ON e.id = et.event_id
    WHERE ${scoped(sql, scope)}
  )`;

/**
 * Parts in evenings as a whole, one row per person, role and evening, as a
 * subquery: `profile_id`, `role` (organizer, co-host or MC), and the
 * evening's `event_id` and `start_date`.
 */
export const roleAppearances = (
  sql: SqlClient,
  scope: { readonly whose: Whose; readonly when: When },
): Statement.Fragment => sql`(
    SELECT ep.profile_id, ep.role, e.id AS event_id, e.start_date
    FROM event_people ep
    JOIN events e ON e.id = ep.event_id
    WHERE ${scoped(sql, scope)}
  )`;

/**
 * Talks given, latest evening first, then in their evening's running order,
 * for rows of {@link talkAppearances}.
 */
export const latestTalkFirst = (
  sql: SqlClient,
  a: AppearanceAlias,
): Statement.Fragment =>
  sql.literal(
    `${a}.start_date DESC, ${a}.event_id, ${a}.position NULLS LAST, ${a}.listed_at, ${a}.talk_id`,
  );

/** How statements alias a relation of appearances. */
export type AppearanceAlias = "a" | "g" | "x";

/**
 * Appearances latest evening first, for rows with an evening's
 * `start_date` and `event_id`: ids break ties between evenings that start
 * together.
 */
export const latestAppearanceFirst = (
  sql: SqlClient,
  a: AppearanceAlias,
): Statement.Fragment => sql.literal(`${a}.start_date DESC, ${a}.event_id`);
