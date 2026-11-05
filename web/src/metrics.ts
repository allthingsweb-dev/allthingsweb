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
 * A path as a point keeps it: each segment that could name a person or
 * hold a secret replaced by what it was, so a mistyped or crafted URL
 * never stores one. A segment with an `@` (an email address, raw or
 * encoded) becomes `(email)`. One of 24 or more letters, digits and `_`
 * with no `-`, or with capitals and digits among its `-`s, becomes
 * `(token)`: a token or a key. So does one with such a part between its
 * dots, a JWT among them, one that is a UUID, and one of 8 or more
 * letters and digits mixed with no separator (a short code). The site's
 * own paths have none of these but a photo's id: slugs are lowercase
 * words and dates joined by `-`, and a photo's version is 10 digits. A segment that doesn't decode becomes `(malformed)`. Then
 * at most {@link pathLimit} characters.
 */
export function redactedPath(pathname: string): string {
  const isTokenLike = (part: string) =>
    /^[A-Za-z0-9_]{24,}$/.test(part) ||
    (/^[A-Za-z0-9_-]{24,}$/.test(part) &&
      /[A-Z]/.test(part) &&
      /[0-9]/.test(part)) ||
    // An id: a UUID, as a reset or invitation link might carry.
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      part,
    ) ||
    // A short random code: 8 or more letters and digits, both, unbroken.
    (/^[A-Za-z0-9]{8,}$/.test(part) &&
      /[0-9]/.test(part) &&
      /[A-Za-z]/.test(part));
  return pathname
    .split("/")
    .map((segment) => {
      // Decoded until it no longer changes (three times at most), so an
      // address encoded twice over (`%2540`) is found too.
      let decoded = segment;
      for (let pass = 0; pass < 3 && decoded.includes("%"); pass++) {
        try {
          decoded = decodeURIComponent(decoded);
        } catch {
          // A malformed escape could hide either (`%40` beside `%ZZ`), so
          // the segment is never kept.
          return "(malformed)";
        }
      }
      if (/@|%40/i.test(decoded)) return "(email)";
      // Each part between dots is checked, so a JWT (three such parts) is
      // a token too, and a file name (`photo.jpg`) isn't.
      if (
        decoded.split(".").some(isTokenLike) ||
        // A JWT, however short its parts: a base64url JSON header first.
        /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(decoded)
      ) {
        return "(token)";
      }
      return segment;
    })
    .join("/")
    .slice(0, pathLimit);
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
 * `/people/erik` is `/people/*` and `/` is `/`. A first segment no route of
 * the site could have (a dot, other characters, over 32 of them: `/.env`,
 * `/wp-login.php`) is `/(other)`, which keeps the classes few.
 */
export function pathClass(pathname: string): string {
  // Redacted first, so a token-like first segment is never an index.
  const [first = "", ...rest] = redactedPath(pathname)
    .replace(/^\/+/, "")
    .split("/");
  if (first === "") return "/";
  if (!/^[a-z0-9_-]{1,32}$/i.test(first)) return "/(other)";
  const segment = first.toLowerCase();
  return rest.length > 0 ? `/${segment}/*` : `/${segment}`;
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
      redactedPath(pathname),
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
