import { asOf } from "allthings-core/src/clock.ts";
import { EventPages } from "allthings-core/src/event-page.ts";
import { PeopleDirectory } from "allthings-core/src/people-directory.ts";
import { slugPattern as personSlugPattern } from "allthings-core/src/person-slug.ts";
import { Context, Effect, Layer, Option } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type { Image, OgMetrics, PhotoBox } from "../../scripts/build.ts";
import { built } from "../assets.ts";
import { CacheControl } from "../cache.ts";
import { repositories } from "../database.ts";
import {
  fetchOriginal,
  Images,
  type ImagesBinding,
  type ImageTransformer,
  maxResizeBytes,
  withTransformBudget,
} from "../images/route.ts";
import { eventPath, mediaOrigin } from "../links.ts";
import { Site } from "../site.ts";
import { ogCards } from "./cards.ts";
import {
  type CardText,
  cardFacts,
  cardPath,
  layoutCard,
} from "./event-card.ts";
import {
  layoutPersonCard,
  personCardFacts,
  personCardGround,
  personCardPath,
} from "./person-card.ts";

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
 * - `/og/people/<slug>.jpg`: a person's card (person-card.ts), drawn the
 *   same way over the people card's ground, with their photo (or the blank
 *   avatar) drawn into its box first, and named by their page with its
 *   version: a new photo, title or handle is a new card.
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

/** What a card is drawn with, when the Worker has both. */
interface Drawing {
  readonly images: ImagesBinding;
  readonly text: NonNullable<ImagesBinding["text"]>;
  readonly assets: AssetsBinding;
}

/** The Images binding and the assets, or none when either is missing. */
const drawing = Effect.gen(function* () {
  const images = yield* Images;
  const assets = yield* Assets;
  if (
    Option.isNone(images) ||
    Option.isNone(assets) ||
    images.value.text === undefined
  ) {
    return Option.none<Drawing>();
  }
  return Option.some<Drawing>({
    images: images.value,
    // Bound: workerd's binding methods throw when called detached from it.
    text: images.value.text.bind(images.value),
    assets: assets.value,
  });
});

/** One of the Worker's own assets, as a stream. */
async function asset(
  assets: AssetsBinding,
  image: Image,
  origin: string,
): Promise<ReadableStream<Uint8Array>> {
  const response = await assets.fetch(
    new Request(new URL(image.src, origin).href),
  );
  if (!response.ok || response.body === null) {
    throw new Error(`${image.src} answered ${response.status}`);
  }
  return response.body;
}

/** A photo to draw into a box, square, cropped to fill it as portraits are. */
interface Photo {
  readonly body: ReadableStream<Uint8Array>;
  readonly box: PhotoBox;
}

/** How a card is encoded: an event's as a PNG, a person's (a photo) as a JPEG. */
type CardFormat = "image/png" | "image/jpeg";

/** A JPEG card's quality: the grain and the type stay crisp, well under 300 KB. */
const jpegQuality = 85;

/**
 * `ground` with `photo` drawn into its box, then `texts` over it,
 * encoded as `format`.
 */
async function draw(
  { images, text, assets }: Drawing,
  ground: Image,
  texts: ReadonlyArray<CardText>,
  origin: string,
  format: CardFormat,
  photo?: Photo,
): Promise<Response> {
  let card: ImageTransformer = images.input(
    await asset(assets, ground, origin),
  );
  if (photo !== undefined) {
    const { side, top, left } = photo.box;
    card = card.draw(
      images
        .input(photo.body)
        .transform({ width: side, height: side, fit: "cover" }),
      { top, left },
    );
  }
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
  return (
    await card.output(
      format === "image/jpeg" ? { format, quality: jpegQuality } : { format },
    )
  ).response();
}

/** A drawing that failed, logged: the card isn't drawn this time. */
const notDrawn = (what: string) => (cause: unknown) =>
  Effect.logError(`Error drawing the card for ${what}:`, cause).pipe(
    Effect.as(undefined),
  );

/** The event's card, drawn: undefined when Images can't draw it. */
const drawCard = (slug: string, origin: string) =>
  Effect.gen(function* () {
    const found = yield* readEvent(slug);
    if (Option.isNone(found)) return Option.none<Response | undefined>();
    const tools = yield* drawing;
    if (Option.isNone(tools)) {
      return Option.some<Response | undefined>(undefined);
    }
    const facts = cardFacts(found.value, yield* asOf);
    const texts = layoutCard(facts, yield* loadMetrics);
    const ground =
      facts.mode === "night"
        ? built.og.cards.eventNight
        : built.og.cards.eventPaper;
    const drawn = yield* Effect.tryPromise(() =>
      draw(tools.value, ground, texts, origin, "image/png"),
    ).pipe(Effect.catchCause(notDrawn(slug)));
    return Option.some(drawn);
  });

/** The person at `slug`: found, moved to another slug, or no one. */
const readPerson = (slug: string) =>
  PeopleDirectory.use((directory) => directory.person(slug, mediaOrigin)).pipe(
    Effect.provide(repositories),
  );

/**
 * What `/og/people/<slug>.jpg` finds: no one; the slug they moved to; or
 * their card, drawn, which is undefined when it can't be drawn this time
 * (no Images binding, an original too large to hand it, no room in the
 * budget, or a failure on the way).
 */
const drawPersonCard = (slug: string, origin: string) =>
  Effect.gen(function* () {
    const found = yield* readPerson(slug);
    if (found.kind === "none") return { kind: "none" } as const;
    if (found.kind === "moved") {
      return { kind: "moved", slug: found.slug } as const;
    }
    const drawn = (response: Response | undefined) =>
      ({ kind: "drawn", response }) as const;
    const tools = yield* drawing;
    if (Option.isNone(tools)) return drawn(undefined);
    const facts = personCardFacts(found.person);
    const texts = layoutPersonCard(facts, yield* loadMetrics);
    const ground = personCardGround(facts);
    const box = built.og.personPhoto;
    const avatar = Effect.tryPromise(async () =>
      draw(tools.value, ground, texts, origin, "image/jpeg", {
        body: await asset(tools.value.assets, built.marks.avatarPng, origin),
        box,
      }),
    );
    if (facts.photo === null) {
      return drawn(yield* avatar.pipe(Effect.catchCause(notDrawn(slug))));
    }
    const { media } = yield* Site;
    const photo = facts.photo;
    return drawn(
      yield* Effect.gen(function* () {
        const original = yield* fetchOriginal(photo.key, media);
        // A photo the media origin no longer has: the blank avatar, as their page shows.
        if (original === undefined) return yield* avatar;
        const { body } = original.response;
        const length = Number(
          original.response.headers.get("content-length") ?? Number.NaN,
        );
        // Images takes an original whole, so only one whose size is known
        // and small enough is handed to it, within the isolate's budget.
        if (
          body === null ||
          !Number.isFinite(length) ||
          length > maxResizeBytes
        ) {
          yield* Effect.promise(() => body?.cancel() ?? Promise.resolve());
          return undefined;
        }
        const made = yield* withTransformBudget(
          length,
          Effect.tryPromise(() =>
            draw(tools.value, ground, texts, origin, "image/jpeg", {
              body,
              box,
            }),
          ).pipe(
            // A body Images never read is let go of.
            Effect.tapCause(() =>
              Effect.promise(() => body.cancel().catch(() => undefined)),
            ),
          ),
        );
        if (Option.isNone(made)) {
          yield* Effect.promise(() => body.cancel().catch(() => undefined));
          return undefined;
        }
        return made.value;
      }).pipe(Effect.catchCause(notDrawn(slug))),
    );
  });

/** A drawn card, kept a day. */
const cardResponse = (
  body: ReadableStream<Uint8Array> | null,
  contentType: CardFormat,
) =>
  HttpServerResponse.raw(
    new Response(body, {
      headers: {
        "content-type": contentType,
        "cache-control": cardCacheControl,
        "x-content-type-options": "nosniff",
      },
    }),
  );

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
    return cardResponse(drawn.value.body, "image/png");
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Error serving a card:", cause).pipe(
        Effect.as(redirect(ogCards.home.src, 302, CacheControl.failure)),
      ),
    ),
  ),
);

/**
 * A person's card at `/og/people/<slug>.jpg`; a slug they had before
 * redirects to their card at their current one, for good, as their page
 * does. When it can't be drawn, the people card stands in, never kept.
 */
const personCardRoute = HttpRouter.add(
  "GET",
  "/og/people/:file",
  Effect.gen(function* () {
    const { file = "" } = yield* HttpRouter.params;
    const slug = file.endsWith(".jpg") ? decoded(file.slice(0, -4)) : undefined;
    if (slug === undefined || !personSlugPattern.test(slug)) return notFound;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const { origin } = new URL(request.originalUrl);
    const found = yield* drawPersonCard(slug, origin);
    if (found.kind === "none") return notFound;
    if (found.kind === "moved") {
      return redirect(personCardPath(found.slug), 301, CacheControl.page);
    }
    if (found.response === undefined) {
      return redirect(ogCards.people.src, 302, CacheControl.failure);
    }
    return cardResponse(found.response.body, "image/jpeg");
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Error serving a person's card:", cause).pipe(
        Effect.as(redirect(ogCards.people.src, 302, CacheControl.failure)),
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

export const ogRoutes = Layer.mergeAll(
  card,
  personCardRoute,
  legacyCards,
  eventQr,
  urlQr,
);
