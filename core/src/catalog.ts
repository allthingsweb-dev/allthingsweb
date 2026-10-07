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

/** How statements alias the events table. */
export type EventAlias = "e" | "ev";

const column = (sql: SqlClient, e: EventAlias, name: string) =>
  sql.literal(`${e}.${name}`);

/** The evenings anyone may see: every one but drafts. */
export const published = (sql: SqlClient, e: EventAlias): Statement.Fragment =>
  sql`${column(sql, e, "is_draft")} = false`;

/**
 * Evenings not over at `now`: upcoming, or live through their end, as
 * {@link eventStatus} has it.
 */
export const ahead = (
  sql: SqlClient,
  e: EventAlias,
  now: DateTime.Utc,
): Statement.Fragment =>
  sql`${column(sql, e, "end_date")} >= ${DateTime.toDateUtc(now)}`;

/** Evenings over at `now`: past, as {@link eventStatus} has it. */
export const ended = (
  sql: SqlClient,
  e: EventAlias,
  now: DateTime.Utc,
): Statement.Fragment =>
  sql`${column(sql, e, "end_date")} < ${DateTime.toDateUtc(now)}`;

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
