/**
 * One anonymous Analytics Engine data point per request the Worker answers
 * (`REQUESTS`, infra/src/web.ts), so the site can say which paths answer
 * 404 and how often the page store keeps what visitors ask for
 * (web/scripts/requests.ts reads them back). Workers Cache answers its hits
 * before the Worker starts, so those are never counted here: what this
 * measures is what reached the Worker.
 *
 * A point holds nothing that identifies a person: no address, no user
 * agent, no query string, no cookie, no referrer. The user agent is read
 * once, for a coarse `bot` or `human`, and dropped.
 *
 * - `indexes`: the path's class, Analytics Engine's sampling key.
 * - `blobs`: the class, the path (no query, redacted by
 *   {@link redactedPath}), what answered (`store-hit`, `img-miss`, `none`, … from
 *   Server-Timing), the data center (`colo`), the method, `bot` or `human`.
 * - `doubles`: the status, then how long the Worker took in milliseconds.
 *
 * It imports nothing. The Worker loads it after each answer is sent
 * (worker.ts), so it is no part of a cold start.
 */

/**
 * The datasets the points go to, bound as `REQUESTS` (infra/src/web.ts).
 * Prod has its own, so what it answers is allthings.dev's alone; every
 * other stage (PR previews, staging, personal stages) shares the other. A
 * dataset needs no provisioning: it exists from its first write, and keeps
 * each point for three months.
 */
export const REQUESTS_DATASET = {
  prod: "allthings_requests",
  preview: "allthings_requests_preview",
} as const;

export type RequestsDataset =
  (typeof REQUESTS_DATASET)[keyof typeof REQUESTS_DATASET];

/** The part of an Analytics Engine binding the Worker uses. */
export interface RequestDataset {
  writeDataPoint(point: {
    readonly indexes: ReadonlyArray<string>;
    readonly blobs: ReadonlyArray<string>;
    readonly doubles: ReadonlyArray<number>;
  }): void;
}

/** How many characters of a path a point keeps. */
export const pathLimit = 200;

/**
 * The first segments of the site's own routes whose deeper paths are
 * slugs: an evening's, a person's, a short link's, a lab variant's, an
 * API resource's. Only below these is a path kept segment by segment;
 * below any other first segment, a point keeps that segment alone and
 * `/…` for the rest, so whatever a crafted URL carries after it is never
 * stored. Photo variants (`/img/…`) are kept as their class: their paths
 * are the site's own, and a 404 there says enough by its count.
 */
export const slugRoots: ReadonlySet<string> = new Set([
  "events",
  "people",
  "speakers",
  "about",
  "brand",
  "lab",
  "r",
  "api",
  "code-of-conduct",
]);

/**
 * The single words the site has pages and routes under (its sections, the
 * lab's, its feeds and the old app's retired paths), which a point keeps
 * as they are; any other single word could be a code, and is `(word)`.
 */
export const siteWords: ReadonlySet<string> = new Set([
  ...slugRoots,
  "_site",
  "home",
  "now",
  "feed",
  "rss",
  "sitemap",
  "robots",
  "mcp",
  "og",
  "img",
  "assets",
  "logos",
  "monitoring",
  "profile",
  "handler",
  "admin",
  "v1",
]);

/**
 * One segment as a point may keep it, decoded: the site's own shape, two
 * or more lowercase words, with numbers of at most 4 digits among them,
 * joined by `-`, `_` or `.` (`2024-11-12-react-at-vercel`,
 * `erik-thorelli`, `wp-login.php`). A single word is kept only where the
 * site has a page of that name ({@link siteWords}). Anything else is
 * replaced by what it was: `(email)` for an address however often
 * encoded, `(malformed)` for an escape that doesn't decode or is still
 * encoded after 8 passes, `(word)` for any other single word, and
 * `(code)` for every other shape (capitals, numbers alone or longer than
 * 4 digits, letters and digits mixed: tokens, keys, ids, codes). A
 * marker an earlier pass wrote stays as it is, so the report's second
 * pass over stored paths gives the same result.
 */
function keptSegment(segment: string): string {
  if (/^\((?:email|malformed|code|word)\)$|^…$/.test(segment)) return segment;
  let decoded = segment;
  for (let pass = 0; pass < 8 && decoded.includes("%"); pass++) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return "(malformed)";
    }
  }
  if (/@|%40/i.test(decoded)) return "(email)";
  if (decoded.includes("%")) return "(malformed)";
  // An empty word is a separator at an end or doubled (`_site`, `a--b`).
  const words = decoded.split(/[-_.]/).filter((word) => word !== "");
  const shaped = words.every(
    (word) => /^[a-z]+$/.test(word) || /^[0-9]{1,4}$/.test(word),
  );
  if (!shaped || !words.some((word) => /^[a-z]+$/.test(word))) {
    return "(code)";
  }
  if (words.length === 1 && !siteWords.has(decoded)) return "(word)";
  return segment;
}

/**
 * A path as a point keeps it, so a mistyped or crafted URL never stores
 * what could name a person or hold a secret: below the site's slug routes
 * ({@link slugRoots}) each segment as {@link keptSegment} keeps it; below
 * any other first segment only that segment, then `/…`; photo variants as
 * `/img/…`. Then at most {@link pathLimit} characters. The 404 report
 * passes stored paths through it again, so older points are kept to the
 * same rule.
 */
export function redactedPath(pathname: string): string {
  const [first = "", ...rest] = pathname.replace(/^\/+/, "").split("/");
  if (first === "") return "/";
  const root = keptSegment(first);
  const kept =
    first === "img"
      ? "/img/…"
      : slugRoots.has(first)
        ? `/${[root, ...rest.map(keptSegment)].join("/")}`
        : rest.length === 0
          ? `/${root}`
          : `/${root}/…`;
  return kept.slice(0, pathLimit);
}

/** The `REQUESTS` binding, if the Worker has one. */
export const requestDatasetOf = (
  env: Readonly<Record<string, unknown>>,
): RequestDataset | undefined => {
  const dataset: unknown = env["REQUESTS"];
  return typeof dataset === "object" &&
    dataset !== null &&
    typeof Reflect.get(dataset, "writeDataPoint") === "function"
    ? (dataset as RequestDataset)
    : undefined;
};

/**
 * A path's class: its first segment, with `/*` when more follows, so
 * `/people/erik` is `/people/*` and `/` is `/`, for the first segments the
 * site has ({@link siteWords}). Any other first segment (`/.env`,
 * `/wp-login.php`, a mistyped or crafted URL) is `/(other)`: the classes
 * stay few, and an index never holds what a URL carried.
 */
export function pathClass(pathname: string): string {
  const [first = "", ...rest] = pathname.replace(/^\/+/, "").split("/");
  if (first === "") return "/";
  if (!siteWords.has(first)) return "/(other)";
  return rest.length > 0 ? `/${first}/*` : `/${first}`;
}

/**
 * What answered, from the response's Server-Timing: the page store's
 * `store;desc="hit"|"miss"|"bypass"` as `store-hit` and so on, a photo
 * variant's `img;desc=…` as `img-…`, or `none`.
 */
export function answeredBy(response: Response): string {
  const timing = response.headers.get("server-timing") ?? "";
  const found = /(?:^|,)\s*(store|img);desc="([a-z]+)"/.exec(timing);
  return found === null ? "none" : `${found[1]}-${found[2]}`;
}

/** Words a crawler, a script or a monitor names itself with. */
const automated =
  /bot|crawl|spider|slurp|preview|fetch|curl|wget|python|go-http|headless|monitor|scan/i;

/** `bot` for a user agent that names itself automated (or none), else `human`. */
export const visitorKind = (userAgent: string | null): "bot" | "human" =>
  userAgent === null || userAgent === "" || automated.test(userAgent)
    ? "bot"
    : "human";

/** The point for one request, as {@link recordRequest} writes it. */
export function requestPoint(
  request: Request,
  response: Response,
  tookMs: number,
): {
  readonly indexes: [string];
  readonly blobs: [string, string, string, string, string, string];
  readonly doubles: [number, number];
} {
  const { pathname } = new URL(request.url);
  const kind = pathClass(pathname);
  const cf: unknown = Reflect.get(request, "cf");
  const colo: unknown =
    typeof cf === "object" && cf !== null ? Reflect.get(cf, "colo") : undefined;
  return {
    indexes: [kind],
    blobs: [
      kind,
      // A path the site answered is one of its own; any other (a 404, a
      // refusal) is kept as its class alone, so nothing a crafted URL
      // carries is ever stored.
      response.status < 400 ? redactedPath(pathname) : kind,
      answeredBy(response),
      typeof colo === "string" ? colo : "",
      request.method,
      visitorKind(request.headers.get("user-agent")),
    ],
    doubles: [response.status, Math.max(0, tookMs)],
  };
}

/**
 * Writes the request's point, if the Worker has a dataset (`REQUESTS` in
 * `env`). Never throws: a point that can't be written is lost, and the
 * visitor's answer is not.
 */
export function recordRequest(
  env: Readonly<Record<string, unknown>>,
  request: Request,
  response: Response,
  /** When the Worker started on it (`Date.now()`). */
  started: number,
): void {
  try {
    const dataset = requestDatasetOf(env);
    // The writers' own paths (refresh, prewarm and its dry run, the
    // variants check) are no visitor's, and a dry run writes nothing.
    if (
      dataset === undefined ||
      new URL(request.url).pathname.startsWith("/_site/")
    ) {
      return;
    }
    dataset.writeDataPoint(
      requestPoint(request, response, Date.now() - started),
    );
  } catch {
    // Analytics never fails a request.
  }
}

/** For the Worker, which loads this module after each answer (worker.ts). */
export default recordRequest;
