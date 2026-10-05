import { EventPages } from "allthings-core/src/event-page.ts";
import { Context, DateTime, Effect, Layer, Option } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { OgMetrics } from "../../scripts/build.ts";
import { built } from "../assets.ts";
import { CacheControl } from "../cache.ts";
import { repositories } from "../database.ts";
import { Images, type ImageTransformer } from "../images/route.ts";
import { eventPath, mediaOrigin } from "../links.ts";
import { Site } from "../site.ts";
import { ogCards } from "./cards.ts";
import { cardFacts, cardPath, layoutCard } from "./event-card.ts";

/**
 * Link-preview cards and QR codes:
 *
 * - `/og/<name>.png`: a page's card, at a URL that never changes. The
 *   brand's cards for pages that don't change with data are files
 *   (cards.ts), which this redirects to; an event's (event-card.ts) is
 *   drawn here: its ground fetched from the Worker's own assets, its words
 *   set over it by the Images binding in the site's fonts. The edge cache
 *   keeps each a day, and its page names it with its version, so a changed
 *   event gets a new card at once.
 * - The current site's card routes (`/api/v1/preview.png` and the rest)
 *   redirect for good to their counterparts here.
 * - `/api/v1/<slug>/qr.png`: a QR code to the event's page, and
 *   `/api/v1/qr.png?url=`: one to any page of this site, as the current
 *   site draws them for slides and posters. The encoder (qr.ts) is loaded
 *   only when one is asked for.
 */

/** What the Worker uses of its static assets binding, `ASSETS`. */
export interface AssetsBinding {
  readonly fetch: (request: Request) => Promise<Response>;
}

const isAssetsBinding = (value: unknown): value is AssetsBinding =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { fetch?: unknown }).fetch === "function";

/** The Worker's static assets, which hold the cards' grounds. */
export class Assets extends Context.Reference<Option.Option<AssetsBinding>>(
  "allthings/web/Assets",
  { defaultValue: () => Option.none() },
) {
  static readonly layer = (env: Readonly<Record<string, unknown>>) =>
    Layer.succeed(Assets, Option.liftPredicate(env["ASSETS"], isAssetsBinding));
}

/** A drawn card: kept a day, served stale a week while it is drawn again. */
const cardCacheControl =
  "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";

/** The cards that are files, by the name `/og/<name>.png` gives them. */
const pageCards: Readonly<Record<string, string>> = {
  home: ogCards.home.src,
  events: ogCards.events.src,
  people: ogCards.people.src,
  about: ogCards.about.src,
  "code-of-conduct": ogCards.codeOfConduct.src,
  brand: ogCards.brand.src,
  "not-found": ogCards.notFound.src,
};

const redirect = (location: string, status: 301 | 302, cacheControl: string) =>
  HttpServerResponse.text(status === 301 ? "Moved Permanently" : "Found", {
    status,
    headers: { location, "cache-control": cacheControl },
  });

const notFound = HttpServerResponse.text("Not Found", {
  status: 404,
  headers: { "cache-control": CacheControl.notFound },
});

/** og.py's measures of the card fonts, read only when a card is drawn. */
const loadMetrics = Effect.promise(
  async (): Promise<OgMetrics> =>
    (await import("../../dist/og-metrics.json", { with: { type: "json" } }))
      .default,
);

/** The published event at `slug`, or none. */
const readEvent = (slug: string) =>
  EventPages.use((pages) => pages.read(slug, mediaOrigin)).pipe(
    Effect.map(Option.some),
    Effect.catchTag("EventNotFound", () => Effect.succeedNone),
    Effect.provide(repositories),
  );

/** `segment` decoded, or undefined when it doesn't decode. */
function decoded(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/** The event's card, drawn: undefined when Images can't draw it. */
const drawCard = (slug: string, origin: string) =>
  Effect.gen(function* () {
    const found = yield* readEvent(slug);
    if (Option.isNone(found)) return Option.none<Response | undefined>();
    const images = yield* Images;
    const assets = yield* Assets;
    if (
      Option.isNone(images) ||
      Option.isNone(assets) ||
      images.value.text === undefined
    ) {
      return Option.some<Response | undefined>(undefined);
    }
    // Bound: workerd's binding methods throw when called detached from it.
    const text = images.value.text.bind(images.value);
    const facts = cardFacts(found.value, yield* DateTime.now);
    const texts = layoutCard(facts, yield* loadMetrics);
    const ground =
      facts.mode === "night"
        ? built.og.cards.eventNight
        : built.og.cards.eventPaper;
    const drawn = yield* Effect.tryPromise(async () => {
      const base = await assets.value.fetch(
        new Request(new URL(ground.src, origin).href),
      );
      if (!base.ok || base.body === null) {
        throw new Error(`the card's ground answered ${base.status}`);
      }
      let card: ImageTransformer = images.value.input(base.body);
      for (const run of texts) {
        card = card.draw(
          text(run.text, {
            font: { url: new URL(built.og.fonts[run.font], origin).href },
            color: run.color,
            size: run.size,
          }),
          { top: run.top, left: run.left },
        );
      }
      return (await card.output({ format: "image/png" })).response();
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError(`Error drawing the card for ${slug}:`, cause).pipe(
          Effect.as(undefined),
        ),
      ),
    );
    return Option.some(drawn);
  });

const card = HttpRouter.add(
  "GET",
  "/og/:file",
  Effect.gen(function* () {
    const { file = "" } = yield* HttpRouter.params;
    const name = file.endsWith(".png") ? decoded(file.slice(0, -4)) : undefined;
    if (name === undefined || name === "") return notFound;
    const page = pageCards[name];
    if (page !== undefined) return redirect(page, 302, CacheControl.page);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const { origin } = new URL(request.originalUrl);
    const drawn = yield* drawCard(name, origin);
    if (Option.isNone(drawn)) return notFound;
    if (drawn.value === undefined) {
      // Not drawn this time: the site's card instead, and never kept.
      return redirect(ogCards.home.src, 302, CacheControl.failure);
    }
    return HttpServerResponse.raw(
      new Response(drawn.value.body, {
        headers: {
          "content-type": "image/png",
          "cache-control": cardCacheControl,
          "x-content-type-options": "nosniff",
        },
      }),
    );
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Error serving a card:", cause).pipe(
        Effect.as(redirect(ogCards.home.src, 302, CacheControl.failure)),
      ),
    ),
  ),
);

/** The current site's cards, which link previews still hold, here for good. */
const legacyCards = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/api/v1/preview.png",
    redirect("/og/home.png", 301, CacheControl.page),
  ),
  HttpRouter.add(
    "GET",
    "/api/v1/speakers.png",
    redirect("/og/people.png", 301, CacheControl.page),
  ),
  ...(["preview.png", "thumbnail.png"] as const).map((file) =>
    HttpRouter.add(
      "GET",
      `/api/v1/:slug/${file}`,
      Effect.map(HttpRouter.params, ({ slug = "" }) =>
        redirect(cardPath(slug), 301, CacheControl.page),
      ),
    ),
  ),
);

const qrResponse = (url: string) =>
  Effect.promise(async () => {
    const { qrPng } = await import("./qr.ts");
    return HttpServerResponse.uint8Array(await qrPng(url), {
      contentType: "image/png",
      headers: { "cache-control": CacheControl.page },
    });
  });

/** A QR code to the event's page, or not found when there is no such event. */
const eventQr = HttpRouter.add(
  "GET",
  "/api/v1/:slug/qr.png",
  Effect.gen(function* () {
    const { slug = "" } = yield* HttpRouter.params;
    const name = decoded(slug);
    if (name === undefined) return notFound;
    const found = yield* readEvent(name);
    if (Option.isNone(found)) return notFound;
    const { origin } = yield* Site;
    return yield* qrResponse(`${origin}${eventPath(found.value.slug)}`);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Error drawing a QR code:", cause).pipe(
        Effect.as(
          HttpServerResponse.text("Error generating QR code", {
            status: 500,
            headers: { "cache-control": CacheControl.failure },
          }),
        ),
      ),
    ),
  ),
);

/**
 * A QR code to `?url=`, a page of this site: a URL anywhere else is
 * refused, so the site never vouches for a code to someone else's page.
 */
const urlQr = HttpRouter.add(
  "GET",
  "/api/v1/qr.png",
  Effect.gen(function* () {
    const { url } = yield* HttpServerRequest.ParsedSearchParams;
    const { origin } = yield* Site;
    const target = typeof url === "string" ? URL.parse(url) : null;
    if (target === null || target.origin !== origin) {
      return HttpServerResponse.text(
        `The url parameter must be a page of ${origin}`,
        {
          status: 400,
          headers: { "cache-control": CacheControl.notFound },
        },
      );
    }
    return yield* qrResponse(target.href);
  }),
);

export const ogRoutes = Layer.mergeAll(card, legacyCards, eventQr, urlQr);
