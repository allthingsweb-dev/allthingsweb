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

/** Pages built at once. */
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
  report.failed.includes("/sitemap.xml");

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

  const counts = { kept: 0, built: 0, passed: 0 };
  const failed: Array<string> = [];
  /** Asks for `path` as a visitor in the system's mode would, and waits for its keeping. */
  const ask = async (path: string): Promise<Response | undefined> => {
    const pendingWork: Array<Promise<unknown>> = [];
    try {
      const response = await serve(
        new Request(`https://allthings.dev${path}`, {
          headers: { "accept-encoding": "br, gzip" },
        }),
        { waitUntil: (promise) => pendingWork.push(promise) },
      );
      const keeping = (await Promise.allSettled(pendingWork)).flatMap(
        (settled) =>
          settled.status === "fulfilled" && isKeeping(settled.value)
            ? [settled.value]
            : [],
      );
      const how = servedAs(response);
      if (response.status >= 500) failed.push(path);
      else if (how === "hit") counts.kept += 1;
      else if (how !== "miss" || keeping.length === 0) counts.passed += 1;
      // Built is kept: a page whose write failed failed.
      else if (keeping.every(({ kept }) => kept)) counts.built += 1;
      else failed.push(path);
      return response;
    } catch {
      failed.push(path);
      return undefined;
    }
  };

  /** `path`'s body read, or failed once, never thrown. */
  const finish = async (path: string, response: Response | undefined) => {
    try {
      return response?.ok === true ? await response.text() : "";
    } catch {
      if (!failed.includes(path)) failed.push(path);
      return "";
    } finally {
      await response?.body?.cancel().catch(() => undefined);
    }
  };

  const xml = await finish("/sitemap.xml", await ask("/sitemap.xml"));
  const paths = sitemapPaths(xml).filter((path) => path !== "/sitemap.xml");
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, paths.length) }, async () => {
      while (next < paths.length) {
        const path = paths[next];
        next += 1;
        if (path === undefined) continue;
        await finish(path, await ask(path));
      }
    }),
  );
  return { paths: paths.length + 1, ...counts, failed, waitedMs: pending };
}
