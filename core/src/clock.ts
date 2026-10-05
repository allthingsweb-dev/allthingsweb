import { DateTime, Effect } from "effect";

/**
 * The instant a page reads its evenings as of: the `Clock`'s now, at the
 * start of its minute.
 *
 * Pages pass it to Postgres, through Hyperdrive, which answers a query it
 * has seen within its cache's lifetime (a minute; infra/src/web.ts) without
 * asking Neon. A query is the same query only with the same parameters, so
 * an exact instant made every page's read new each millisecond. Read as of
 * the minute, every page read within that minute is the same query, and a
 * page is at most a minute behind, which the Worker's own cache already
 * allows (a page is fresh for a minute; web/src/cache.ts).
 *
 * Everything else about the page uses the same instant: an evening is
 * upcoming, live or past as of the minute, so the page never disagrees
 * with the rows it was given.
 */
export const pageNow: Effect.Effect<DateTime.Utc> = Effect.map(
  DateTime.now,
  DateTime.startOf("minute"),
);
