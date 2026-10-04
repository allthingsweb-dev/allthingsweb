import { Home } from "allthings-core/src/home.ts";
import { Effect, Layer } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { CacheControl } from "../cache.ts";
import { repositories } from "../database.ts";
import { mediaOrigin } from "../links.ts";
import { Site } from "../site.ts";
import { brandPage } from "./brand.tsx";
import { isTheme, type Theme } from "./document.tsx";
import { homePage, unavailablePage } from "./home.tsx";
import { htmlResponse } from "./response.ts";

/**
 * The site's pages. A page is a function of its data; /brand has none
 * beyond the build, so each of its three forms is rendered once per isolate.
 */

/**
 * The home page reads the database on every request it reaches, and is
 * cached like the API's public data. Once pages are keyed by data version,
 * it can be cached until the data changes instead.
 */
const home = HttpRouter.add(
  "GET",
  "/",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const acceptEncoding = request.headers["accept-encoding"];
    const { origin } = yield* Site;
    return yield* Home.use((repository) => repository.read(mediaOrigin)).pipe(
      Effect.provide(repositories),
      Effect.map((view) =>
        htmlResponse(homePage({ home: view, origin }), acceptEncoding, {
          cacheControl: CacheControl.publicData,
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.logError("Error rendering the home page:", cause).pipe(
          Effect.as(
            htmlResponse(unavailablePage(), acceptEncoding, {
              cacheControl: CacheControl.failure,
              status: 503,
            }),
          ),
        ),
      ),
    );
  }),
);

const brandPages = new Map<Theme | undefined, string>();

function renderBrand(theme: Theme | undefined): string {
  const cached = brandPages.get(theme);
  if (cached !== undefined) return cached;
  const html = brandPage(theme);
  brandPages.set(theme, html);
  return html;
}

/** `?theme=light` or `?theme=dark` fixes the mode; otherwise it follows the system. */
const brand = HttpRouter.add(
  "GET",
  "/brand",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const { theme } = yield* HttpServerRequest.ParsedSearchParams;
    return htmlResponse(
      renderBrand(
        typeof theme === "string" && isTheme(theme) ? theme : undefined,
      ),
      request.headers["accept-encoding"],
      { cacheControl: CacheControl.page },
    );
  }),
);

export const pageRoutes = Layer.mergeAll(home, brand);
