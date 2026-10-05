import type { DataSourceError } from "allthings-core/src/errors.ts";
import { Home } from "allthings-core/src/home.ts";
import { Portraits, type PortraitsById } from "allthings-core/src/portraits.ts";
import { Effect, Layer } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import type * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { repositories } from "../database.ts";
import { hosts, mediaOrigin } from "../links.ts";
import { Site } from "../site.ts";
import { brandPage } from "./brand.tsx";
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
}

/**
 * A page at `path`. `?theme=` on it is the header's mode switch: the
 * choice is remembered and the visitor sent back to the page without it
 * (see theme.ts). An unknown `theme` value is ignored.
 */
const page = <E, R>(
  path: `/${string}`,
  render: (
    request: PageRequest,
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  HttpRouter.add(
    "GET",
    path,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const { theme } = yield* HttpServerRequest.ParsedSearchParams;
      if (typeof theme === "string" && isChoice(theme)) {
        return chooseTheme(theme, path, request.url);
      }
      return yield* render({
        theme: themeOf(request.cookies),
        acceptEncoding: request.headers["accept-encoding"],
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
 * The home page reads the database on every request it reaches, and is
 * cached like the API's public data. Once pages are keyed by data version,
 * it can be cached until the data changes instead. Its evenings and the
 * hosts' portraits are read at once, over the request's pool.
 */
const home = page("/", ({ theme, acceptEncoding }) =>
  Effect.gen(function* () {
    const { origin } = yield* Site;
    return yield* Effect.all(
      [
        Home.use((repository) => repository.read(mediaOrigin)),
        footer(hostPortraits),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.provide(repositories),
      Effect.map(([view, { portraits, read }]) =>
        htmlResponse(
          homePage({ home: view, origin, theme, portraits }),
          acceptEncoding,
          { cacheControl: read ? "publicData" : "failure", theme },
        ),
      ),
      Effect.catchCause((cause) =>
        Effect.logError("Error rendering the home page:", cause).pipe(
          Effect.as(
            htmlResponse(unavailablePage({ origin, theme }), acceptEncoding, {
              cacheControl: "failure",
              theme,
              status: 503,
            }),
          ),
        ),
      ),
    );
  }),
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

export const pageRoutes = Layer.mergeAll(home, brand);
