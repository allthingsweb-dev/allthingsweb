import type { DataSourceError } from "allthings-core/src/errors.ts";
import { Evenings } from "allthings-core/src/evenings.ts";
import { EventPages } from "allthings-core/src/event-page.ts";
import { Home } from "allthings-core/src/home.ts";
import { httpUrlOrNull } from "allthings-core/src/mappers.ts";
import { Portraits, type PortraitsById } from "allthings-core/src/portraits.ts";
import { Redirects } from "allthings-core/src/redirects.ts";
import { Effect, Layer, Option } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { CacheControl } from "../cache.ts";
import { type Repositories, repositories } from "../database.ts";
import { hosts, mediaOrigin } from "../links.ts";
import { Site } from "../site.ts";
import { brandPage } from "./brand.tsx";
import { calendarFile, calendarFileName } from "./calendar.ts";
import {
  eventPage,
  eventPagePath,
  eventUnavailablePage,
  notFoundPage,
} from "./event.tsx";
import { eventsPage } from "./events.tsx";
import { homePage, unavailablePage } from "./home.tsx";
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
    },
  ) => string,
) =>
  page(path, ({ theme, acceptEncoding }) =>
    Effect.gen(function* () {
      const { origin } = yield* Site;
      return yield* Effect.all([read, footer(hostPortraits)], {
        concurrency: "unbounded",
      }).pipe(
        Effect.provide(repositories),
        Effect.map(([data, { portraits, read: complete }]) =>
          htmlResponse(
            render(data, { origin, theme, portraits }),
            acceptEncoding,
            { cacheControl: complete ? "publicData" : "failure", theme },
          ),
        ),
        Effect.catchCause((cause) =>
          Effect.logError(`Error rendering ${name}:`, cause).pipe(
            Effect.as(
              htmlResponse(
                unavailablePage({ origin, path, theme }),
                acceptEncoding,
                {
                  cacheControl: "failure",
                  theme,
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
const brand = page("/brand", ({ theme, acceptEncoding }) =>
  Effect.gen(function* () {
    const { origin } = yield* Site;
    const { portraits, read } = yield* footer(
      hostPortraits.pipe(Effect.provide(repositories)),
    );
    return htmlResponse(
      brandPage({ origin, theme, portraits }),
      acceptEncoding,
      { cacheControl: read ? "page" : "failure", theme },
    );
  }),
);

/** An event's page, at its slug: encoded, so it is always one segment. */
const eventPath = (params: PageRequest["params"]): `/${string}` =>
  eventPagePath(params["slug"] ?? "");

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
  ({ theme, acceptEncoding, params }) =>
    Effect.gen(function* () {
      const { origin } = yield* Site;
      const path = eventPath(params);
      return yield* Effect.all(
        [readEvent(params["slug"] ?? ""), footer(hostPortraits)],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.provide(repositories),
        Effect.map(([found, { portraits, read }]) =>
          Option.match(found, {
            onNone: () =>
              htmlResponse(
                notFoundPage({ origin, path, theme, portraits }),
                acceptEncoding,
                {
                  cacheControl: read ? "notFound" : "failure",
                  theme,
                  status: 404,
                },
              ),
            onSome: (view) =>
              htmlResponse(
                eventPage({ event: view, origin, theme, portraits }),
                acceptEncoding,
                { cacheControl: read ? "publicData" : "failure", theme },
              ),
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.logError("Error rendering an event page:", cause).pipe(
            Effect.as(
              htmlResponse(
                eventUnavailablePage({ origin, path, theme }),
                acceptEncoding,
                { cacheControl: "failure", theme, status: 503 },
              ),
            ),
          ),
        ),
      );
    }),
  eventPath,
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

export const pageRoutes = Layer.mergeAll(
  home,
  events,
  brand,
  event,
  calendar,
  shortLink,
);
