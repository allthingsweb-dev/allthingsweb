import { Context, Data, Effect, Layer, Option, Semaphore } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { CacheControl, immutable } from "../cache.ts";
import { Site } from "../site.ts";
import {
  encodeKey,
  formats,
  parseVariant,
  type Size,
  type Variant,
  variantPath,
} from "./variants.ts";

/**
 * GET /img/<size>/<format>/<version>/<key> (see variants.ts): the photo at
 * `<media origin>/<key>`, resized and re-encoded by Cloudflare's Images
 * binding, then kept in the edge cache under its URL, so each variant is
 * made once per data center and served from the cache after that. Its URL
 * names the photo's version, so browsers and caches keep it for a year.
 *
 * When the variant can't be made (no `IMAGES` binding, as in tests that
 * don't bind one; an original over {@link maxResizeBytes}; a photo the
 * binding refuses; Images' monthly allowance used up), the original is sent
 * as it is, briefly cached, so the page still shows the photo and a later
 * request tries again.
 *
 * Memory: an isolate has 128 MB, a browser asks for several variants at
 * once, and an original may be tens of megabytes. So:
 *
 * - Every response is handed to the runtime as a web `Response`, which
 *   pipes its body natively with backpressure; no body passes through an
 *   Effect stream, which reads ahead of a slow client.
 * - An original is sent as it is, untouched, when its Content-Length says
 *   it is over {@link maxResizeBytes} or doesn't say: it is piped, never
 *   read.
 * - The binding takes an original whole before it resizes it, so the
 *   originals being resized at once in an isolate add up to at most
 *   {@link transformBudgetBytes}. A request beyond that checks again every
 *   {@link budgetPoll} (workerd cancels a request that waits on another
 *   request's promise as hung, so it can't simply queue), and after
 *   {@link budgetWait} sends the original as it is instead.
 * - When Images has read an original and refused it, the Worker fetches it
 *   again to send it, from the media origin's edge cache; if that fetch
 *   fails too, the failure is what the page gets.
 */

/** What the Worker uses of the Images binding (workerd's `ImagesBinding`). */
export interface ImagesBinding {
  readonly input: (stream: ReadableStream<Uint8Array>) => ImageTransformer;
  /**
   * Text rasterized into an image (og/route.ts draws event cards with it).
   * Alchemy's local runtime has none, so it may be missing.
   */
  readonly text?: (content: string, options: TextOptions) => ImageTransformer;
}

/** How `text` sets its words: a font file by URL, its color and size in pixels. */
export interface TextOptions {
  readonly font: { readonly url: string };
  readonly color: string;
  readonly size: number;
}

export interface ImageTransformer {
  readonly transform: (transform: ImageTransform) => ImageTransformer;
  /** Draws `overlay` over the image with its top left at `top`, `left`. */
  readonly draw: (
    overlay: ImageTransformer,
    options: { readonly top: number; readonly left: number },
  ) => ImageTransformer;
  readonly output: (options: {
    readonly format: string;
  }) => Promise<ImageTransformationResult>;
}

interface ImageTransform {
  readonly width: number;
  readonly height?: number;
  readonly fit: "scale-down" | "cover";
}

interface ImageTransformationResult {
  readonly response: () => Response;
  readonly contentType: () => string;
}

/** What the Worker uses of the Cache API's `caches.default`. */
export interface EdgeCache {
  readonly match: (key: string) => Promise<Response | undefined>;
  readonly put: (key: string, response: Response) => Promise<void>;
}

// workerd's bindings keep their methods on their prototypes, so they are
// read, not looked up as own properties.
const hasMethods = (value: unknown, ...names: Array<string>): boolean =>
  typeof value === "object" &&
  value !== null &&
  names.every(
    (name) => typeof (value as Record<string, unknown>)[name] === "function",
  );

const isImagesBinding = (value: unknown): value is ImagesBinding =>
  hasMethods(value, "input");

const isEdgeCache = (value: unknown): value is EdgeCache =>
  hasMethods(value, "match", "put");

/**
 * The Worker's `IMAGES` binding, if it has one. Bindings are fixed for an
 * isolate, so it is looked up once. Pages offer variants only when it is
 * there; without it they link the originals on the media origin.
 */
export class Images extends Context.Reference<Option.Option<ImagesBinding>>(
  "allthings/web/Images",
  { defaultValue: () => Option.none() },
) {
  static readonly layer = (env: Readonly<Record<string, unknown>>) =>
    Layer.succeed(Images, Option.liftPredicate(env["IMAGES"], isImagesBinding));
}

/**
 * The data center's cache (`caches.default`), where workerd has one: Bun,
 * which runs the pages' unit tests, doesn't.
 */
export class Cache extends Context.Reference<Option.Option<EdgeCache>>(
  "allthings/web/Cache",
  {
    defaultValue: () =>
      Option.liftPredicate(
        (globalThis as { caches?: { default?: unknown } }).caches?.default,
        isEdgeCache,
      ),
  },
) {}

/**
 * Keeps the request's invocation alive until `promise` settles, after the
 * response is sent: the Worker passes its `ExecutionContext.waitUntil` for
 * each request (see worker.ts). Without one, the promise just runs.
 */
export class WaitUntil extends Context.Reference<
  (promise: Promise<unknown>) => void
>("allthings/web/WaitUntil", {
  defaultValue: () => (promise) => {
    promise.catch(() => undefined);
  },
}) {}

/**
 * The largest original the Worker resizes; larger ones go as they are. The
 * binding reads up to 20 MB, but handing it one costs the request memory
 * (or CPU: Cloudflare reports both as error 1102) in step with its size.
 * Measured on a preview, sequential requests for fresh variants failed
 * with 1102 about half the time for 15 to 20 MB originals and one time in
 * eight at 9 to 10 MB, and never for 6.65 MB (20 of 20, and 12 of 12 at
 * once). Uploads are re-encoded under this (core/scripts/reencode-originals.ts).
 */
export const maxResizeBytes = 8_000_000;

/**
 * The most original bytes an isolate hands the Images binding at once:
 * three originals at {@link maxResizeBytes}.
 */
export const transformBudgetBytes = 3 * maxResizeBytes;

const permitBytes = 1_000_000;

/**
 * Megabytes of the budget, shared by every request the isolate serves.
 * Requests in one isolate share its memory, so they share this too.
 */
const transformBudget = Semaphore.makeUnsafe(
  transformBudgetBytes / permitBytes,
);

/** How often a request waiting for the budget checks it again. */
const budgetPoll = "50 millis";

/** How long a request waits for the budget before it sends the original. */
const budgetWait = 15_000;

/**
 * Takes `permits` of the budget, checking every {@link budgetPoll}: true
 * once taken, false when {@link budgetWait} passes first.
 */
const takeBudget = (permits: number) =>
  Effect.gen(function* () {
    const deadline = Date.now() + budgetWait;
    while (!(yield* Semaphore.takeIfAvailable(transformBudget, permits))) {
      if (Date.now() > deadline) return false;
      yield* Effect.sleep(budgetPoll);
    }
    return true;
  });

/** The budget an original of `length` bytes takes while it is resized. */
const permitsFor = (length: number) =>
  Math.min(
    transformBudgetBytes / permitBytes,
    Math.max(1, Math.ceil(length / permitBytes)),
  );

/** Originals sent as they are, when no variant could be made. */
const originalCacheControl = "public, max-age=300";

/** The raster types an original may be sent as, from this origin. */
const rasterTypes = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const transformOf = (size: Size): ImageTransform =>
  size.kind === "width"
    ? { width: size.width, fit: "scale-down" }
    : { width: size.side, height: size.side, fit: "cover" };

class FetchFailed extends Data.TaggedError("FetchFailed")<{
  readonly cause: unknown;
}> {}

class TransformFailed extends Data.TaggedError("TransformFailed")<{
  readonly cause: unknown;
}> {}

const notFound = HttpServerResponse.text("Not Found", {
  status: 404,
  headers: { "cache-control": CacheControl.notFound },
});

const badGateway = HttpServerResponse.text("Bad Gateway", {
  status: 502,
  headers: { "cache-control": CacheControl.failure },
});

/**
 * `response`, as the runtime sends it: its body piped natively, never
 * through an Effect stream.
 */
const native = (response: Response): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.raw(response);

/** `response` with how it was served, for the browser's timing panel. */
function withTiming(response: Response, timing: string): Response {
  const headers = new Headers(response.headers);
  headers.set("server-timing", timing);
  return new Response(response.body, { status: response.status, headers });
}

/** The original as it is, a raster image of `contentType`. */
const asOriginal = (
  body: ReadableStream<Uint8Array> | null,
  contentType: string,
): HttpServerResponse.HttpServerResponse =>
  native(
    new Response(body, {
      headers: {
        "content-type": contentType,
        "cache-control": originalCacheControl,
        "x-content-type-options": "nosniff",
        "server-timing": 'img;desc="original"',
      },
    }),
  );

/**
 * The original of `variant` from `media`, when it is there as a raster
 * image: `undefined` when the media origin has no such photo. Only the
 * key's own object is fetched, never where a redirect points, and its body
 * is left unread, so the Worker never holds a whole original in memory.
 */
const fetchOriginal = (variant: Variant, media: string) =>
  Effect.gen(function* () {
    const original = yield* Effect.tryPromise({
      try: () =>
        fetch(`${media}/${encodeKey(variant.key)}`, { redirect: "manual" }),
      catch: (cause) => new FetchFailed({ cause }),
    });
    const contentType =
      (original.headers.get("content-type") ?? "")
        .split(";")[0]
        ?.trim()
        .toLowerCase() ?? "";
    const found = original.status === 200;
    // Only raster images are made into variants or sent from this origin,
    // so the media origin can't put a page here.
    if (found && rasterTypes.has(contentType)) {
      return { response: original, contentType };
    }
    yield* Effect.promise(() => original.body?.cancel() ?? Promise.resolve());
    if (original.status === 404 || original.status === 410) return undefined;
    return yield* Effect.fail(
      new FetchFailed({
        cause: found
          ? `the media origin sent ${contentType}`
          : `the media origin answered ${original.status}`,
      }),
    );
  });

/** The variant, made from the original at `media` and stored at `cacheKey`. */
const serve = (variant: Variant, media: string, cacheKey: string) =>
  Effect.gen(function* () {
    const cache = yield* Cache;
    if (Option.isSome(cache)) {
      // A cache that can't be read is a miss.
      const hit = yield* Effect.tryPromise(() =>
        cache.value.match(cacheKey),
      ).pipe(Effect.orElseSucceed(() => undefined));
      if (hit !== undefined) {
        return native(withTiming(hit, 'img;desc="hit"'));
      }
    }

    const started = Date.now();
    const original = yield* fetchOriginal(variant, media);
    if (original === undefined) return notFound;
    const { response, contentType } = original;

    const images = yield* Images;
    // An original whose size isn't known is never handed to the binding.
    const length = Number(response.headers.get("content-length") ?? Number.NaN);
    if (
      Option.isNone(images) ||
      !Number.isFinite(length) ||
      length > maxResizeBytes ||
      response.body === null
    ) {
      return asOriginal(response.body, contentType);
    }

    // The original's body waits, unread, until the budget has room for it.
    const permits = permitsFor(length);
    if (!(yield* takeBudget(permits))) {
      return asOriginal(response.body, contentType);
    }
    const made = yield* Effect.tryPromise({
      try: () =>
        images.value
          .input(response.body ?? new ReadableStream())
          .transform(transformOf(variant.size))
          .output({ format: formats[variant.format] }),
      catch: (cause) => new TransformFailed({ cause }),
    }).pipe(
      Effect.ensuring(Semaphore.release(transformBudget, permits)),
      Effect.map(Option.some),
      Effect.catchTag("TransformFailed", (error) =>
        Effect.logWarning(
          `Error making ${variantPath(variant)}; sending the original:`,
          error.cause,
        ).pipe(Effect.as(Option.none<ImageTransformationResult>())),
      ),
    );
    if (Option.isNone(made)) {
      // Images read the first copy; the media origin's edge has another.
      const again = yield* fetchOriginal(variant, media);
      if (again === undefined) return notFound;
      return asOriginal(again.response.body, again.contentType);
    }

    // What Images made: AVIF it can't encode in time comes as WebP. That
    // is sent, but briefly and never stored, so a later request can make
    // the format the URL names.
    const madeType = made.value.contentType();
    const asNamed = madeType === formats[variant.format];
    const headers = {
      "content-type": madeType,
      "cache-control": asNamed ? immutable : originalCacheControl,
      "x-content-type-options": "nosniff",
    };
    let body = made.value.response().body;
    if (Option.isSome(cache) && asNamed && body !== null) {
      const [sent, stored] = body.tee();
      body = sent;
      const waitUntil = yield* WaitUntil;
      // A variant that can't be stored is made again next time.
      waitUntil(
        cache.value
          .put(cacheKey, new Response(stored, { headers }))
          .catch(() => undefined),
      );
    }
    return native(
      new Response(body, {
        headers: {
          ...headers,
          "server-timing": `img;desc="miss";dur=${Date.now() - started}`,
        },
      }),
    );
  });

export const imageRoutes = HttpRouter.add(
  "GET",
  "/img/*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.originalUrl);
    const variant = parseVariant(url.pathname);
    if (variant === undefined) return notFound;
    const { media } = yield* Site;
    // One entry per variant, whatever the query.
    return yield* serve(variant, media, `${url.origin}${url.pathname}`);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Error serving an image variant:", cause).pipe(
        Effect.as(badGateway),
      ),
    ),
  ),
);
