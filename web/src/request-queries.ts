import { pathClass, REQUESTS_DATASET } from "./metrics.ts";
import { isNotFoundShape } from "./not-found.ts";

/**
 * What web/scripts/requests.ts asks of the Worker's request data points
 * (metrics.ts), in Analytics Engine's SQL. Each point stands for
 * `_sample_interval` requests, so counts are sums of it. A point's columns:
 * `blob1` the path's class, `blob2` the path, `blob3` what answered,
 * `blob4` the data center, `blob5` the method, `blob6` `bot` or `human`,
 * `blob7` a 404's kind (not-found.ts), empty in points written
 * before kinds were;
 * `double1` the status, `double2` the milliseconds the Worker took.
 */

/** The allthings Cloudflare account (infra/README.md, "Accounts and stages"). */
export const ANALYTICS_ACCOUNT = "af627f300cd00c4dca56aacf05bea050";

/** Which stage's points: prod's (allthings.dev), or every other stage's. */
export type RequestsStage = keyof typeof REQUESTS_DATASET;

/** The window the queries read: the last `days` days. */
const since = (days: number) =>
  `timestamp > NOW() - INTERVAL '${Math.trunc(days)}' DAY`;

/**
 * The 404s by kind (`blob7`; empty for points written before kinds were),
 * with how many of those asked were bots.
 */
export const notFoundKindsQuery = (stage: RequestsStage, days: number) =>
  `SELECT blob7 AS kind, SUM(_sample_interval) AS requests, ` +
  `SUM(IF(blob6 = 'bot', _sample_interval, 0)) AS bots ` +
  `FROM ${REQUESTS_DATASET[stage]} WHERE ${since(days)} AND double1 = 404 ` +
  `GROUP BY kind ORDER BY requests DESC`;

/**
 * The 404 shapes asked most (`blob2`: a 404 keeps its shape, not-found.ts),
 * with their kind and how many of those asked were bots.
 */
export const top404Query = (
  stage: RequestsStage,
  days: number,
  limit: number,
) =>
  `SELECT blob7 AS kind, blob2 AS path, SUM(_sample_interval) AS requests, ` +
  `SUM(IF(blob6 = 'bot', _sample_interval, 0)) AS bots ` +
  `FROM ${REQUESTS_DATASET[stage]} WHERE ${since(days)} AND double1 = 404 ` +
  `GROUP BY kind, path ORDER BY requests DESC LIMIT ${Math.trunc(limit)}`;

/**
 * What a report shows of a stored 404's path: its shape when it is one
 * not-found.ts gives, else its class (a point written before shapes were
 * kept its class, and older ones a path), so nothing a URL carried shows.
 */
export const shownPath = (path: string): string =>
  isNotFoundShape(path) ? path : pathClass(path);

/** How many requests reached the Worker in the window. */
export const totalQuery = (stage: RequestsStage, days: number) =>
  `SELECT SUM(_sample_interval) AS requests ` +
  `FROM ${REQUESTS_DATASET[stage]} WHERE ${since(days)}`;

/** The 404s per day (UTC) and kind, oldest first. */
export const notFoundDailyQuery = (stage: RequestsStage, days: number) =>
  `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day, blob7 AS kind, ` +
  `SUM(_sample_interval) AS requests ` +
  `FROM ${REQUESTS_DATASET[stage]} WHERE ${since(days)} AND double1 = 404 ` +
  `GROUP BY day, kind ORDER BY day ASC`;

/** How many requests each part of the Worker answered (`store-hit`, …). */
export const answeredQuery = (stage: RequestsStage, days: number) =>
  `SELECT blob3 AS answered, SUM(_sample_interval) AS requests ` +
  `FROM ${REQUESTS_DATASET[stage]} WHERE ${since(days)} ` +
  `GROUP BY answered ORDER BY requests DESC`;

/** How many requests answered each status. */
export const statusQuery = (stage: RequestsStage, days: number) =>
  `SELECT double1 AS status, SUM(_sample_interval) AS requests ` +
  `FROM ${REQUESTS_DATASET[stage]} WHERE ${since(days)} ` +
  `GROUP BY status ORDER BY requests DESC`;

/** A row as Analytics Engine's SQL API answers it: numbers may come as strings. */
export type Row = Readonly<Record<string, string | number | null>>;

const count = (value: string | number | null | undefined) =>
  Number(value ?? 0) || 0;

/**
 * The page store's hit rate among the requests it was asked for:
 * `store-hit` over `store-hit` and `store-miss` (a bypass never asks it),
 * or undefined when it was asked nothing.
 */
export function storeHitRate(rows: ReadonlyArray<Row>): number | undefined {
  const by = (name: string) =>
    count(rows.find((row) => row["answered"] === name)?.["requests"]);
  const hits = by("store-hit");
  const asked = hits + by("store-miss");
  return asked === 0 ? undefined : hits / asked;
}

/** A 404 row's kind as shown: `(none)` for points written before kinds were. */
const kindOf = (row: Row) => {
  const kind = String(row["kind"] ?? "");
  return kind === "" ? "(none)" : kind;
};

/** The report, as text: the statuses, what answered, the 404s by kind and the top ones. */
export function formatReport(
  { stage, days }: { readonly stage: RequestsStage; readonly days: number },
  {
    statuses,
    answered,
    kinds,
    notFound,
  }: {
    readonly statuses: ReadonlyArray<Row>;
    readonly answered: ReadonlyArray<Row>;
    readonly kinds: ReadonlyArray<Row>;
    readonly notFound: ReadonlyArray<Row>;
  },
): string {
  const total = statuses.reduce((sum, row) => sum + count(row["requests"]), 0);
  const share = (n: number) =>
    total === 0 ? "" : ` (${((100 * n) / total).toFixed(1)}%)`;
  const rate = storeHitRate(answered);
  return [
    `${REQUESTS_DATASET[stage]}, the last ${days} days: ${total} requests reached the Worker`,
    "",
    "status",
    ...statuses.map(
      (row) =>
        `  ${String(row["status"])}  ${count(row["requests"])}${share(count(row["requests"]))}`,
    ),
    "",
    `answered by (page store hit rate: ${rate === undefined ? "n/a" : `${(100 * rate).toFixed(1)}%`})`,
    ...answered.map(
      (row) => `  ${String(row["answered"])}  ${count(row["requests"])}`,
    ),
    "",
    "404s by kind (requests, of them bots)",
    ...(kinds.length === 0
      ? ["  none"]
      : kinds.map(
          (row) =>
            `  ${count(row["requests"])}  ${count(row["bots"])}  ${kindOf(row)}`,
        )),
    "",
    "top 404s (requests, of them bots, kind, path)",
    ...(notFound.length === 0
      ? ["  none"]
      : notFound.map(
          (row) =>
            `  ${count(row["requests"])}  ${count(row["bots"])}  ${kindOf(row)}  ${shownPath(String(row["path"]))}`,
        )),
  ].join("\n");
}
