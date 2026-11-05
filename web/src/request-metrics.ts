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
 * `(token)`: a token or a key. The site's own paths have neither: slugs
 * are lowercase words and dates joined by `-`, and a photo's version is
 * 10 digits. Then at most {@link pathLimit} characters.
 */
export function redactedPath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        // A malformed escape is kept as it was sent.
      }
      if (decoded.includes("@")) return "(email)";
      if (
        /^[A-Za-z0-9_]{24,}$/.test(decoded) ||
        (/^[A-Za-z0-9_-]{24,}$/.test(decoded) &&
          /[A-Z]/.test(decoded) &&
          /[0-9]/.test(decoded))
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
  const [first = "", ...rest] = pathname.replace(/^\/+/, "").split("/");
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
 * Writes the request's point, if the Worker has a dataset. Never throws: a
 * point that can't be written is lost, and the visitor's answer is not.
 */
export function recordRequest(
  dataset: RequestDataset | undefined,
  request: Request,
  response: Response,
  tookMs: number,
): void {
  if (dataset === undefined) return;
  try {
    dataset.writeDataPoint(requestPoint(request, response, tookMs));
  } catch {
    // Analytics never fails a request.
  }
}
