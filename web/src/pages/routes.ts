import { About } from "allthings-core/src/about.ts";
import type { DataSourceError } from "allthings-core/src/errors.ts";
import { Evenings } from "allthings-core/src/evenings.ts";
import { EventPages } from "allthings-core/src/event-page.ts";
import { Home } from "allthings-core/src/home.ts";
import { httpUrlOrNull } from "allthings-core/src/mappers.ts";
import { PeopleDirectory } from "allthings-core/src/people-directory.ts";
import { Portraits, type PortraitsById } from "allthings-core/src/portraits.ts";
import { Redirects } from "allthings-core/src/redirects.ts";
import { Duration, Effect, Layer, Option } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { CacheControl } from "../cache.ts";
import { type Repositories, repositories } from "../database.ts";
import { Images } from "../images/route.ts";
import { aboutPath, eventPath, hosts, mediaOrigin } from "../links.ts";
import { Site } from "../site.ts";
import { aboutPage } from "./about.tsx";
import { calendarFile, calendarFileName } from "./calendar.ts";
import { codeOfConductPage, codeOfConductPath } from "./code-of-conduct.tsx";
import { eventPage, eventUnavailablePage, notFoundPage } from "./event.tsx";
import { eventsPage } from "./events.tsx";
import { homePage, unavailablePage } from "./home.tsx";
import { peoplePage } from "./people.tsx";
import type { ImageMode } from "./picture.tsx";
import { htmlResponse } from "./response.ts";
import { chooseTheme, isChoice, type Theme, themeOf } from "./theme.ts";

/**
 * The site's pages. A page is a function of its data, of the mode its
 * visitor chose, and of the hosts' portraits that sign it off.
 */

/** What every page is rendered for. */
interface PageRequest {
  /** The mode the visitor's cookie fixes, if any. */
  readonly theme: Theme | undefined;
  readonly acceptEncoding: string | undefined;
  /** Variants when the Worker has its Images binding, else originals. */
  readonly images: ImageMode;
  /** The route's parameters, such as an event's `slug`. */
  readonly params: Readonly<Record<string, string | undefined>>;
}

/**
 * A page at `route`. `?theme=` on it is the header's mode switch: the
 * choice is remembered and the visitor sent back to the page without it
 * (see theme.ts), at the path `location` builds from the route's
 * parameters (the route itself unless it has some). An unknown `theme`
 * value is ignored.
 */
const page = <E, R>(
  route: `/${string}`,
  render: (
    request: PageRequest,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
  location: (params: PageRequest["params"]) => `/${string}` = () => route,
) =>
  HttpRouter.add(
    "GET",
    route,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const params = yield* HttpRouter.params;
      const { theme } = yield* HttpServerRequest.ParsedSearchParams;
      if (typeof theme === "string" && isChoice(theme)) {
        return chooseTheme(theme, location(params), request.url);
      }
      return yield* render({
        theme: themeOf(request.cookies),
        acceptEncoding: request.headers["accept-encoding"],
        images: Option.isSome(yield* Images) ? "variants" : "originals",
        params,
      });
    }),
  );

/** The footer's portraits, and whether they could be read. */
interface Footer {
  readonly portraits: PortraitsById;
  readonly read: boolean;
}

/**
 * The hosts' portraits from their profiles. When they can't be read, the
 * blank avatar stands in and the page says so with `read: false`: it is
 * then sent as a failure is, never stored, so the next request tries again.
 */
const footer = <R>(
  portraits: Effect.Effect<PortraitsById, DataSourceError, R>,
): Effect.Effect<Footer, never, R> =>
  portraits.pipe(
    Effect.map((byId): Footer => ({ portraits: byId, read: true })),
    Effect.catchCause((cause) =>
      Effect.logError("Error reading the hosts' portraits:", cause).pipe(
        Effect.as<Footer>({ portraits: new Map(), read: false }),
      ),
    ),
  );

/** The hosts' portraits, by the profile ids links.ts names. */
const hostPortraits = Portraits.use((repository) =>
  repository.read(
    hosts.map((host) => host.profileId),
    mediaOrigin,
  ),
);

/**
 * A page of public data at `path`, read on every request it reaches over
 * the request's pool, at once with the hosts' portraits, and cached like
 * the API's public data. Once pages are keyed by data version, they can be
 * cached until the data changes instead. When the data can't be read, the
 * page says so plainly (503) and is never stored.
 */
const dataPage = <A>(
  path: `/${string}`,
  name: string,
  read: Effect.Effect<A, DataSourceError, Repositories>,
  render: (
    data: A,
    page: {
      readonly origin: string;
      readonly theme: Theme | undefined;
      readonly portraits: PortraitsById;
      readonly images: ImageMode;
    },
  ) => string,
) =>
  page(path, ({ theme, acceptEncoding, images }) =>
    Effect.gen(function* () {
      const { origin } = yield* Site;
      return yield* Effect.all([read, footer(hostPortraits)], {
        concurrency: "unbounded",
      }).pipe(
        Effect.provide(repositories),
        Effect.timed,
        Effect.map(([took, [data, { portraits, read: complete }]]) =>
          htmlResponse(
            render(data, { origin, theme, portraits, images }),
            acceptEncoding,
            {
              cacheControl: complete ? "publicData" : "failure",
              theme,
              db: Duration.toMillis(took),
              images,
            },
          ),
        ),
        Effect.catchCause((cause) =>
          Effect.logError(`Error rendering ${name}:`, cause).pipe(
            Effect.as(
              htmlResponse(
                unavailablePage({ origin, path, theme, images }),
                acceptEncoding,
                {
                  cacheControl: "failure",
                  theme,
                  images,
                  status: 503,
                },
              ),
            ),
          ),
        ),
      );
    }),
  );

/** The home page: the next evening, the ones after it and the latest. */
const home = dataPage(
  "/",
  "the home page",
  Home.use((repository) => repository.read(mediaOrigin)),
  (view, props) => homePage({ home: view, ...props }),
);

/**
 * The people page: the organizers (the hosts links.ts names first), then
 * every speaker, then everyone who co-hosted or MC'd an evening.
 */
const people = dataPage(
  "/people",
  "the people page",
  PeopleDirectory.use((repository) =>
    repository.read(
      hosts.map((host) => host.profileId),
      mediaOrigin,
    ),
  ),
  (view, props) => peoplePage({ people: view, ...props }),
);

/**
 * The about page: what all things is, what it has done so far and where it
 * came from, its organizers (the hosts links.ts names), and how to take
 * part.
 */
const about = dataPage(
  aboutPath,
  "the about page",
  About.use((repository) =>
    repository.read(
      hosts.map((host) => host.profileId),
      mediaOrigin,
    ),
  ),
  (view, props) => aboutPage({ about: view, ...props }),
);

/**
 * /speakers, where the current site lists speakers, is the people page now.
 * The move is permanent and changes only with a deploy, so it is cached as
 * a page is.
 */
const speakers = HttpRouter.add(
  "GET",
  "/speakers",
  Effect.succeed(
    HttpServerResponse.redirect("/people", {
      status: 301,
      headers: { "cache-control": CacheControl.page },
    }),
  ),
);

/** The evenings index: every published evening. */
const events = dataPage(
  "/events",
  "the evenings index",
  Evenings.use((repository) => repository.read),
  (evenings, props) => eventsPage({ evenings, ...props }),
);

/**
 * /brand changes only when the Worker is deployed, but for the hosts'
 * portraits in its footer, which it reads on every request it reaches. It is
 * cached as a page, so a new portrait may take a day to reach the edge.
 */
const brand = page("/brand", ({ theme, acceptEncoding, images }) =>
  Effect.gen(function* () {
    const { origin } = yield* Site;
    // The style guide, foundations and all, is loaded when it is first
    // asked for, so no other page's cold start parses it.
    const { brandPage } = yield* Effect.promise(() => import("./brand.tsx"));
    const { portraits, read } = yield* footer(
      hostPortraits.pipe(Effect.provide(repositories)),
    );
    return htmlResponse(
      brandPage({ origin, theme, portraits, images }),
      acceptEncoding,
      { cacheControl: read ? "page" : "failure", theme, images },
    );
  }),
);

/**
 * The code of conduct changes only when the Worker is deployed, but for the
 * hosts' portraits in its footer; it is cached as a page, as /brand is.
 */
const codeOfConduct = page(
  codeOfConductPath,
  ({ theme, acceptEncoding, images }) =>
    Effect.gen(function* () {
      const { origin } = yield* Site;
      const { portraits, read } = yield* footer(
        hostPortraits.pipe(Effect.provide(repositories)),
      );
      return htmlResponse(
        codeOfConductPage({ origin, theme, portraits, images }),
        acceptEncoding,
        { cacheControl: read ? "page" : "failure", theme, images },
      );
    }),
);

/** An event's page, at its slug: encoded, so it is always one segment. */
const eventLocation = (params: PageRequest["params"]): `/${string}` =>
  eventPath(params["slug"] ?? "");

/** The event at `slug`, or none when no published event has it. */
const readEvent = (slug: string) =>
  EventPages.use((pages) => pages.read(slug, mediaOrigin)).pipe(
    Effect.map(Option.some),
    Effect.catchTag("EventNotFound", () => Effect.succeedNone),
  );

/**
 * /<slug>: an evening's page, cached like the home page. Drafts and unknown
 * slugs are not found, which is cached only briefly: a draft may be
 * published at any moment. The event and the hosts' portraits are read at
 * once, over the request's pool.
 */
const event = page(
  "/:slug",
  ({ theme, acceptEncoding, params, images }) =>
    Effect.gen(function* () {
      const { origin } = yield* Site;
      const path = eventLocation(params);
      return yield* Effect.all(
        [readEvent(params["slug"] ?? ""), footer(hostPortraits)],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.provide(repositories),
        Effect.timed,
        Effect.map(([took, [found, { portraits, read }]]) => {
          const db = Duration.toMillis(took);
          return Option.match(found, {
            onNone: () =>
              htmlResponse(
                notFoundPage({ origin, path, theme, portraits, images }),
                acceptEncoding,
                {
                  cacheControl: read ? "notFound" : "failure",
                  theme,
                  images,
                  status: 404,
                  db,
                },
              ),
            onSome: (view) =>
              htmlResponse(
                eventPage({ event: view, origin, theme, portraits, images }),
                acceptEncoding,
                {
                  cacheControl: read ? "publicData" : "failure",
                  theme,
                  images,
                  db,
                },
              ),
          });
        }),
        Effect.catchCause((cause) =>
          Effect.logError("Error rendering an event page:", cause).pipe(
            Effect.as(
              htmlResponse(
                eventUnavailablePage({ origin, path, theme, images }),
                acceptEncoding,
                { cacheControl: "failure", theme, images, status: 503 },
              ),
            ),
          ),
        ),
      );
    }),
  eventLocation,
);

/** A plain-text answer, for the files and redirects pages link to. */
const plain = (text: string, status: number, cacheControl: CacheControl) =>
  HttpServerResponse.text(text, {
    status,
    headers: { "cache-control": cacheControl },
  });

/**
 * /<slug>/calendar.ics: "add to calendar" for the event at `slug`, cached
 * like its page.
 */
const calendar = HttpRouter.add(
  "GET",
  "/:slug/calendar.ics",
  Effect.gen(function* () {
    const { slug = "" } = yield* HttpRouter.params;
    const { origin } = yield* Site;
    const found = yield* readEvent(slug).pipe(Effect.provide(repositories));
    return Option.match(found, {
      onNone: () => plain("Event not found", 404, CacheControl.notFound),
      onSome: (view) =>
        HttpServerResponse.text(calendarFile(view, origin), {
          contentType: "text/calendar; charset=utf-8",
          headers: {
            "cache-control": CacheControl.publicData,
            "content-disposition": `attachment; filename="${calendarFileName(slug)}"`,
          },
        }),
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Error building a calendar file:", cause).pipe(
        Effect.as(plain("Temporarily unavailable", 503, CacheControl.failure)),
      ),
    ),
  ),
);

/**
 * /r/<slug>: a short link, as the app answers it: a temporary redirect (307,
 * what Next's redirect() sends) to the stored destination, 404 when none
 * is stored. A destination that isn't an http(s) URL is never followed.
 */
const shortLink = HttpRouter.add(
  "GET",
  "/r/:slug",
  Effect.gen(function* () {
    const { slug = "" } = yield* HttpRouter.params;
    const destination = yield* Redirects.use((redirects) =>
      redirects.lookup(slug),
    ).pipe(
      Effect.map((redirect) => httpUrlOrNull(redirect.destinationUrl)),
      Effect.catchTag("RedirectNotFound", () => Effect.succeed(null)),
      Effect.provide(repositories),
    );
    if (destination === null) {
      return plain("Redirect not found", 404, CacheControl.notFound);
    }
    return HttpServerResponse.redirect(destination, {
      status: 307,
      headers: { "cache-control": CacheControl.publicData },
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logError("Error fetching redirect link:", cause).pipe(
        Effect.as(plain("Internal server error", 500, CacheControl.failure)),
      ),
    ),
  ),
);

/**
 * `/_next/image?url=…`: the current site's resized images, which search
 * engines and link previews still hold. A photo on the media origin is
 * redirected to for good; anything else is not found. Both answer as plain
 * text: Cloudflare blocks a `/_next/image` response to anything but an
 * `<img>` unless it is an image or plain text.
 */
const nextImage = HttpRouter.add(
  "GET",
  "/_next/image",
  Effect.gen(function* () {
    const { url } = yield* HttpServerRequest.ParsedSearchParams;
    const target = typeof url === "string" ? URL.parse(url) : null;
    if (target === null || target.origin !== mediaOrigin) {
      return plain("Not Found", 404, CacheControl.notFound);
    }
    return HttpServerResponse.text("Moved Permanently", {
      status: 301,
      headers: { location: target.href, "cache-control": CacheControl.page },
    });
  }),
);

/**
 * Leading slashes as one, and backslashes, which browsers read as slashes,
 * dropped there: a path never reads as another host's ("//x", "/\\x").
 */
const rootPath = (path: string): `/${string}` =>
  `/${path.replace(/^[/\\]+/, "")}`;

/**
 * The site's own page for a path with nothing at it: not found (404), cached
 * only briefly, or gone for good (410).
 */
const nothingAt = (
  path: `/${string}`,
  status: 404 | 410,
  { theme, acceptEncoding, images }: PageRequest,
) =>
  Effect.gen(function* () {
    const { origin } = yield* Site;
    const { portraits, read } = yield* footer(
      hostPortraits.pipe(Effect.provide(repositories)),
    );
    return htmlResponse(
      notFoundPage({ origin, path, theme, portraits, images, status }),
      acceptEncoding,
      {
        cacheControl: !read ? "failure" : status === 410 ? "page" : "notFound",
        theme,
        images,
        status,
      },
    );
  });

/**
 * What the current site served that is retired with it (410): images in
 * the old brand, and Sentry's example page, example API and tunnel.
 */
export const retiredPaths = [
  "/logos/*",
  "/hero-image-404.png",
  "/hero-image-goodbye.png",
  "/hero-image-hackathon.png",
  "/hero-image-meetup.png",
  "/hero-image-rocket.png",
  "/sentry-example-page",
  "/api/sentry-example-api",
  "/monitoring",
] as const;

const retired = retiredPaths.map((route) => {
  // "/logos/*" names /logos and every path under it: the one asked for is
  // the route's start and the rest, if any.
  const start = route.endsWith("/*") ? route.slice(0, -2) : undefined;
  const location = ({ "*": rest }: PageRequest["params"]): `/${string}` =>
    start === undefined
      ? route
      : rest === undefined || rest === ""
        ? rootPath(start)
        : rootPath(`${start}/${rest}`);
  return page(
    route,
    (request) => nothingAt(location(request.params), 410, request),
    location,
  );
});

/**
 * Every other path. One with a trailing slash is the page without it, as
 * the current site redirects it (308); the rest are not found, with the
 * site's own page, cached only briefly.
 */
const elsewhere = page(
  "/*",
  (request) =>
    Effect.gen(function* () {
      const path = `/${request.params["*"] ?? ""}`;
      if (path.length > 1 && path.endsWith("/")) {
        const { url } = yield* HttpServerRequest.HttpServerRequest;
        const { search } = new URL(url, "http://localhost");
        return HttpServerResponse.redirect(
          `${rootPath(path.replace(/\/+$/, ""))}${search}`,
          { status: 308, headers: { "cache-control": CacheControl.page } },
        );
      }
      return yield* nothingAt(rootPath(path), 404, request);
    }),
  ({ "*": rest = "" }) => rootPath(rest),
);

export const pageRoutes = Layer.mergeAll(
  home,
  events,
  people,
  speakers,
  about,
  brand,
  codeOfConduct,
  event,
  calendar,
  shortLink,
  nextImage,
  ...retired,
  elsewhere,
);
