import { type NotFoundKind, notFoundKinds } from "../not-found.ts";
import {
  ANALYTICS_ACCOUNT,
  notFoundDailyQuery,
  notFoundKindsQuery,
  type Row,
  shownPath,
  top404Query,
  totalQuery,
} from "../request-queries.ts";

/**
 * The organizers' 404 page, `/404s` on the draft preview (app.ts): how many
 * requests allthings.dev answered 404 each day, by kind, and the shapes
 * asked most. It reads prod's request data points (metrics.ts) through
 * Analytics Engine's SQL API when the page is asked for, so it shows the
 * dataset's three months, not Workers Logs' 7 days. A point holds a 404's
 * kind and shape (not-found.ts), never its raw path, and the page shows a
 * stored path only when it is a shape not-found.ts could have given.
 */

/** Runs one Analytics Engine SQL query, answering its rows. */
export type AnalyticsSql = (sql: string) => Promise<ReadonlyArray<Row>>;

/** How long one query may take before the page gives up on it. */
export const sqlTimeoutMs = 10_000;

/**
 * Why a query failed, in words fixed here: never the request's, the
 * answer's or an underlying error's, any of which could carry the token.
 */
export class AnalyticsEngineError extends Error {
  readonly _tag = "AnalyticsEngineError";
}

/**
 * Analytics Engine's SQL API, read with `token` (Account Analytics Read).
 * Every failure is an {@link AnalyticsEngineError}.
 */
export const analyticsSql =
  (
    token: string,
    fetcher: typeof fetch = fetch,
    timeoutMs: number = sqlTimeoutMs,
  ): AnalyticsSql =>
  async (sql) => {
    const response = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${ANALYTICS_ACCOUNT}/analytics_engine/sql`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: sql,
        // A stalled answer fails the page (502), never holds it open.
        signal: AbortSignal.timeout(timeoutMs),
      },
    ).catch(() => {
      throw new AnalyticsEngineError(
        `Analytics Engine didn't answer within ${timeoutMs} ms, or the request failed`,
      );
    });
    if (!response.ok) {
      // The status alone: the body may echo the request.
      throw new AnalyticsEngineError(
        `Analytics Engine answered ${response.status}`,
      );
    }
    const body = (await response.json().catch(() => {
      throw new AnalyticsEngineError("Analytics Engine's answer isn't JSON");
    })) as { readonly data?: ReadonlyArray<Row> };
    return body.data ?? [];
  };

/** The windows the page offers, in days; the dataset keeps 90. */
export const windows = [7, 30, 90] as const;

/** The window `?days=` asks for, if it is one the page offers; else 30. */
export const windowOf = (url: URL): number => {
  const days = Number(url.searchParams.get("days"));
  return (windows as ReadonlyArray<number>).includes(days) ? days : 30;
};

/** A kind as the page shows it: `""` is a point written before kinds were. */
type ShownKind = NotFoundKind | "";

/** What the page shows, read from the data points. */
export interface NotFoundReport {
  readonly days: number;
  /** Every request that reached the Worker in the window. */
  readonly total: number;
  /**
   * Each day (UTC, `YYYY-MM-DD`) the window touches, oldest first (the
   * first partly), with its 404s by kind.
   */
  readonly daily: ReadonlyArray<{
    readonly day: string;
    readonly kinds: ReadonlyMap<ShownKind, number>;
  }>;
  readonly kinds: ReadonlyArray<{
    readonly kind: ShownKind;
    readonly requests: number;
    readonly bots: number;
  }>;
  readonly top: ReadonlyArray<{
    readonly kind: ShownKind;
    readonly path: string;
    readonly requests: number;
    readonly bots: number;
  }>;
}

const count = (value: string | number | null | undefined) =>
  Number(value ?? 0) || 0;

const kindOf = (row: Row): ShownKind => {
  const kind = String(row["kind"] ?? "");
  return (notFoundKinds as ReadonlyArray<string>).includes(kind)
    ? (kind as NotFoundKind)
    : "";
};

/** `YYYY-MM-DD` of an Analytics Engine `DateTime` (`2026-11-06 00:00:00`). */
const dayOf = (value: string | number | null | undefined) =>
  String(value ?? "").slice(0, 10);

/** How many shapes the page lists. */
export const topLimit = 50;

/** The report for the last `days` days, ending on `now`'s day (UTC). */
export async function notFoundReport(
  sql: AnalyticsSql,
  days: number,
  now: number,
): Promise<NotFoundReport> {
  const [totals, daily, kinds, top] = await Promise.all([
    sql(totalQuery("prod", days)),
    sql(notFoundDailyQuery("prod", days)),
    sql(notFoundKindsQuery("prod", days)),
    sql(top404Query("prod", days, topLimit)),
  ]);
  // The window is the last `days` × 24 hours, so it starts partway into
  // a UTC day: one bar more than `days`, so every 404 counted is drawn.
  const byDay = new Map<string, Map<ShownKind, number>>();
  for (let back = days; back >= 0; back--) {
    byDay.set(
      new Date(now - back * 86_400_000).toISOString().slice(0, 10),
      new Map(),
    );
  }
  for (const row of daily) {
    const ofDay = byDay.get(dayOf(row["day"]));
    if (ofDay === undefined) continue;
    const kind = kindOf(row);
    ofDay.set(kind, (ofDay.get(kind) ?? 0) + count(row["requests"]));
  }
  return {
    days,
    total: count(totals[0]?.["requests"]),
    daily: [...byDay].map(([day, ofDay]) => ({ day, kinds: ofDay })),
    kinds: kinds.map((row) => ({
      kind: kindOf(row),
      requests: count(row["requests"]),
      bots: count(row["bots"]),
    })),
    top: top.map((row) => ({
      kind: kindOf(row),
      path: shownPath(String(row["path"] ?? "")),
      requests: count(row["requests"]),
      bots: count(row["bots"]),
    })),
  };
}

const escape = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Each kind's name and what it is, as the legend says. */
const kindNames: Readonly<Record<ShownKind, string>> = {
  "well-known": "well-known",
  legacy: "legacy URL",
  probe: "scanner probe",
  guessed: "guessed URL",
  other: "other",
  "": "before kinds",
};

const kindNotes: Readonly<Record<ShownKind, string>> = {
  "well-known": "files browsers and crawlers ask every site for",
  legacy: "the old sites' URLs",
  probe: "scanners after secrets and other sites' software",
  guessed: "pages someone guessed the site has",
  other: "anything else, such as a srcset read as one URL",
  "": "points written before 404s kept their kind",
};

/** Stacked bottom to top in this order; each its categorical slot. */
const stacked: ReadonlyArray<ShownKind> = [...notFoundKinds, ""];

const number = new Intl.NumberFormat("en-US");

/** The daily stacked bars, as inline SVG with a title on each segment. */
function chart(report: NotFoundReport): string {
  const width = 720;
  const height = 220;
  const left = 44;
  const bottom = 24;
  const top = 8;
  const plot = height - bottom - top;
  const totals = report.daily.map(({ kinds }) =>
    [...kinds.values()].reduce((sum, n) => sum + n, 0),
  );
  const max = Math.max(1, ...totals);
  // Three gridlines at round steps.
  const step = 10 ** Math.floor(Math.log10(max));
  const tick =
    [1, 2, 5, 10].map((m) => m * step).find((t) => max / t <= 3) ?? step * 10;
  const ceiling = Math.max(tick, Math.ceil(max / tick) * tick);
  const y = (n: number) => top + plot - (n / ceiling) * plot;
  const slot = (width - left) / report.daily.length;
  const bar = Math.max(2, slot - 2);
  const grid = [];
  for (let t = 0; t <= ceiling; t += tick) {
    grid.push(
      `<line x1="${left}" x2="${width}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${left - 6}" y="${y(t) + 4}" text-anchor="end" class="axis">${number.format(t)}</text>`,
    );
  }
  const bars = report.daily.map(({ day, kinds }, index) => {
    const x = left + index * slot + (slot - bar) / 2;
    let base = 0;
    const segments = stacked.flatMap((kind) => {
      const n = kinds.get(kind) ?? 0;
      if (n === 0) return [];
      const from = y(base);
      base += n;
      const to = y(base);
      // A 2px surface gap between stacked segments.
      const h = Math.max(1, from - to - (base === n ? 0 : 2));
      return [
        `<rect x="${x.toFixed(1)}" y="${to.toFixed(1)}" width="${bar.toFixed(1)}" height="${h.toFixed(1)}" class="k-${kind === "" ? "none" : kind}"><title>${day}: ${number.format(n)} ${escape(kindNames[kind])}</title></rect>`,
      ];
    });
    // About eight dates along the axis.
    const label =
      index % Math.ceil(report.daily.length / 8) === 0
        ? `<text x="${(x + bar / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle" class="axis">${day.slice(5)}</text>`
        : "";
    return segments.join("") + label;
  });
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="404s per day by kind, the last ${report.days} days">${grid.join("")}${bars.join("")}</svg>`;
}

const share = (n: number, of: number) =>
  of === 0 ? "" : `${((100 * n) / of).toFixed(1)}%`;

/** The page, as plain as the preview's others, with one inline chart. */
export function notFoundPage(report: NotFoundReport): string {
  const notFound = report.kinds.reduce((sum, row) => sum + row.requests, 0);
  const windowLinks = windows
    .map((days) =>
      days === report.days
        ? `<strong>${days} days</strong>`
        : `<a href="/404s?days=${days}">${days} days</a>`,
    )
    .join(" · ");
  const seen = new Set([
    ...report.kinds.map((row) => row.kind),
    ...report.daily.flatMap(({ kinds }) => [...kinds.keys()]),
  ]);
  const legend = stacked
    .filter((kind) => kind !== "" || seen.has(""))
    .map(
      (kind) =>
        `<li><span class="swatch k-${kind === "" ? "none" : kind}"></span>${escape(kindNames[kind])}</li>`,
    )
    .join("");
  const kindRows = report.kinds
    .map(
      (row) =>
        `<tr><th scope="row"><span class="swatch k-${row.kind === "" ? "none" : row.kind}"></span>${escape(kindNames[row.kind])}<br><small>${escape(kindNotes[row.kind])}</small></th><td>${number.format(row.requests)}</td><td>${share(row.requests, notFound)}</td><td>${number.format(row.bots)}</td></tr>`,
    )
    .join("");
  const topRows = report.top
    .map(
      (row) =>
        `<tr><th scope="row"><code>${escape(row.path)}</code></th><td>${escape(kindNames[row.kind])}</td><td>${number.format(row.requests)}</td><td>${number.format(row.bots)}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>404s · allthings</title><style>${style}</style></head><body><main>
<p><a href="/">Drafts</a></p>
<h1>404s on allthings.dev</h1>
<p>${windowLinks}</p>
<p class="lede"><strong>${number.format(notFound)}</strong> requests answered 404 in the last ${report.days} days${report.total === 0 ? "" : `, ${share(notFound, report.total)} of the ${number.format(report.total)} that reached the site's Worker`}.</p>
<figure>${chart(report)}<figcaption><ul class="legend">${legend}</ul>Per day (UTC). Workers Cache answers its hits before the Worker, so they aren't counted.</figcaption></figure>
<h2>By kind</h2>
${report.kinds.length === 0 ? "<p>None.</p>" : `<table><thead><tr><th scope="col">Kind</th><th scope="col">Requests</th><th scope="col">Share</th><th scope="col">Of them bots</th></tr></thead><tbody>${kindRows}</tbody></table>`}
<h2>Asked most</h2>
<p>Each 404 is stored as its shape, never its path: a scanner's family, a well-known file, an old site's route, or a guessed word from a fixed list (any other word is <code>(word)</code>, <code>(slug)</code> or <code>(code)</code>).</p>
${report.top.length === 0 ? "<p>None.</p>" : `<table><thead><tr><th scope="col">Shape</th><th scope="col">Kind</th><th scope="col">Requests</th><th scope="col">Of them bots</th></tr></thead><tbody>${topRows}</tbody></table>`}
<p><small>From the Web Worker's request data points in Analytics Engine (<code>allthings_requests</code>, kept three months), read when this page is asked for. The raw paths of the last 7 days are in Workers Logs: the saved query "allthings 404s" in the Cloudflare dashboard.</small></p>
</main></body></html>`;
}

/** The page's colors: the categorical slots in fixed order, light and dark. */
const style = `
:root{color-scheme:light;--surface:#fcfcfb;--ink:#0b0b0b;--ink-2:#52514e;--rule:#e4e3df;
--k1:#2a78d6;--k2:#eb6834;--k3:#1baf7a;--k4:#eda100;--k5:#e87ba4;--k0:#a3a29d}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--surface:#1a1a19;--ink:#f0efec;--ink-2:#c3c2b7;--rule:#3a3936;
--k1:#3987e5;--k2:#d95926;--k3:#199e70;--k4:#c98500;--k5:#d55181;--k0:#6f6e69}}
body{margin:0;background:var(--surface);color:var(--ink);font:16px/1.5 system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:16px}
a{color:inherit}
.lede{font-size:1.15em}
figure{margin:16px 0}
svg{width:100%;height:auto;display:block}
.grid{stroke:var(--rule);stroke-width:1}
.axis{fill:var(--ink-2);font-size:11px}
figcaption{color:var(--ink-2);font-size:.9em}
.legend{list-style:none;padding:0;margin:8px 0;display:flex;flex-wrap:wrap;gap:4px 16px;color:var(--ink)}
.swatch{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:baseline}
.k-well-known{fill:var(--k1);background:var(--k1)}.k-legacy{fill:var(--k2);background:var(--k2)}
.k-probe{fill:var(--k3);background:var(--k3)}.k-guessed{fill:var(--k4);background:var(--k4)}
.k-other{fill:var(--k5);background:var(--k5)}.k-none{fill:var(--k0);background:var(--k0)}
rect{rx:2px}
table{border-collapse:collapse;width:100%;margin:8px 0 24px;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--rule);vertical-align:top}
td{text-align:right;white-space:nowrap}
thead th{color:var(--ink-2);font-weight:500}
small{color:var(--ink-2);font-weight:400}
code{font-size:.9em;overflow-wrap:anywhere}
`;
