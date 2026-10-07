import { DateTime, Effect } from "effect";

/**
 * The instant every public read is as of: the `Clock`'s now, at the start
 * of its minute. The pages, the feeds, the MCP tools (and so the CLI and
 * the Claude plugin) and the v1 API all read their evenings as of it, so
 * at any moment they agree on which are ahead, live or over (README, "One
 * catalog").
 *
 * They pass it to Postgres, through Hyperdrive, which answers a query it
 * has seen within its cache's lifetime (a minute; infra/src/web.ts) without
 * asking Neon. A query is the same query only with the same parameters, so
 * an exact instant made every read new each millisecond. Read as of the
 * minute, every read within that minute is the same query, and an answer
 * is at most a minute behind, which the Worker's own cache already allows
 * (a page is fresh for a minute; web/src/cache.ts).
 *
 * Everything else about an answer uses the same instant: an evening is
 * upcoming, live or past as of the minute, so an answer never disagrees
 * with the rows it was given.
 */
export const asOf: Effect.Effect<DateTime.Utc> = Effect.map(
  DateTime.now,
  DateTime.startOf("minute"),
);
