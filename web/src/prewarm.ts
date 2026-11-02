import { isKeeping, type SitePointer } from "./page-store.ts";

/**
 * Building the site's pages into the page store before a visitor asks for
 * them: every path the sitemap lists, in the system's mode, through the
 * store itself, so a page already kept costs one KV read and a missing one
 * is built once from the database. The sync asks for it after each run,
 * and a prod deploy after it ships a new build, whose pages start afresh.
 *
 * A new version of the data is used only from its `from` (page-store.ts),
 * so prewarming waits for it, up to {@link longestWait}, rather than warm
 * the version on its way out.
 */

/** The most prewarming waits for a new version to be in use, in milliseconds. */
export const longestWait = 2 * 60 * 1000;

/** Pages built at once; one that fails is asked for once more, alone. */
export const concurrency = 4;

/** What prewarming did. */
export interface PrewarmReport {
  /** Paths asked for, the sitemap's own included. */
  readonly paths: number;
  /** Already kept. */
  readonly kept: number;
  /** Built now, and written to the store. */
  readonly built: number;
  /** Answered without being kept: not keepable, or the store unreachable. */
  readonly passed: number;
  /** Paths that answered 5xx, failed, or whose page couldn't be written. */
  readonly failed: ReadonlyArray<string>;
  /**
   * Whether the sitemap was read, and so the pages it lists were asked
   * for: its own write failing is in `failed`, and isn't this.
   */
  readonly sitemapRead: boolean;
  /** Milliseconds it waited for a new version first. */
  readonly waitedMs: number;
}

/** The paths (with their queries) a sitemap's `<loc>`s name, on any host. */
export function sitemapPaths(xml: string): ReadonlyArray<string> {
  const paths = new Set<string>();
  for (const [, loc] of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const url = URL.parse(
      (loc ?? "").replaceAll("&amp;", "&"),
      "https://allthings.dev",
    );
    if (url !== null) paths.add(`${url.pathname}${url.search}`);
  }
  return [...paths];
}

/** How the store served a response, from its Server-Timing. */
const servedAs = (response: Response) =>
  /store;desc="([a-z]+)"/.exec(
    response.headers.get("server-timing") ?? "",
  )?.[1];

export interface PrewarmOptions {
  /** The site behind the store (worker.ts's handler). */
  readonly serve: (
    request: Request,
    context: { waitUntil(promise: Promise<unknown>): void },
  ) => Promise<Response>;
  /** The pointer as the namespace holds it now. */
  readonly pointer: () => Promise<SitePointer | undefined>;
  /** Milliseconds since the epoch. */
  readonly now: () => number;
  /** Waits `ms` milliseconds. */
  readonly sleep: (ms: number) => Promise<void>;
}

/** Whether prewarming read no sitemap, and so warmed nothing. */
export const sitemapFailed = (report: PrewarmReport): boolean =>
  !report.sitemapRead;

/** Prewarms the store; see the module's comment. */
export async function prewarm({
  serve,
  pointer,
  now,
  sleep,
}: PrewarmOptions): Promise<PrewarmReport> {
  const known = await pointer();
  const at = now();
  const from = known?.next?.from;
  const pending =
    from !== undefined && from > at && from - at <= longestWait ? from - at : 0;
  if (pending > 0) await sleep(pending);

  /** How one path came out, its last time. */
  type Outcome = "kept" | "built" | "passed" | "failed";
  /**
   * Asks for `path` as a visitor in the system's mode would, reads its
   * body, and waits for its keeping: how it came out, and the body when it
   * answered 2xx. Never throws.
   */
  const visit = async (
    path: string,
  ): Promise<{ readonly outcome: Outcome; readonly body?: string }> => {
    const pendingWork: Array<Promise<unknown>> = [];
    let response: Response | undefined;
    try {
      response = await serve(
        new Request(`https://allthings.dev${path}`, {
          headers: { "accept-encoding": "br, gzip" },
        }),
        { waitUntil: (promise) => pendingWork.push(promise) },
      );
      const body = response.ok ? await response.text() : undefined;
      const keeping = (await Promise.allSettled(pendingWork)).flatMap(
        (settled) =>
          settled.status === "fulfilled" && isKeeping(settled.value)
            ? [settled.value]
            : [],
      );
      const how = servedAs(response);
      const outcome: Outcome =
        response.status >= 500
          ? "failed"
          : how === "hit"
            ? "kept"
            : how !== "miss" || keeping.length === 0
              ? "passed"
              : // Built is kept: a page whose write failed failed.
                keeping.every(({ kept }) => kept)
                ? "built"
                : "failed";
      return body === undefined ? { outcome } : { outcome, body };
    } catch {
      return { outcome: "failed" };
    } finally {
      await response?.body?.cancel().catch(() => undefined);
    }
  };

  const outcomes = new Map<string, Outcome>();
  const sitemap = await visit("/sitemap.xml");
  outcomes.set("/sitemap.xml", sitemap.outcome);
  const paths = sitemapPaths(sitemap.body ?? "").filter(
    (path) => path !== "/sitemap.xml",
  );
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, paths.length) }, async () => {
      while (next < paths.length) {
        const path = paths[next];
        next += 1;
        if (path === undefined) continue;
        outcomes.set(path, (await visit(path)).outcome);
      }
    }),
  );
  // A page that failed in the crowd (a database connection refused, say)
  // is asked for once more, alone; its last outcome is the one counted.
  for (const path of paths) {
    if (outcomes.get(path) === "failed") {
      outcomes.set(path, (await visit(path)).outcome);
    }
  }
  const all = [...outcomes.entries()];
  const count = (outcome: Outcome) =>
    all.filter(([, came]) => came === outcome).length;
  return {
    paths: outcomes.size,
    kept: count("kept"),
    built: count("built"),
    passed: count("passed"),
    failed: all.filter(([, came]) => came === "failed").map(([path]) => path),
    sitemapRead: sitemap.body !== undefined,
    waitedMs: pending,
  };
}
