import { Effect, Layer } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { brandPage } from "./brand.tsx";
import { isTheme, type Theme } from "./document.tsx";
import { htmlResponse } from "./response.ts";

/**
 * The site's pages. A page is a function of its data; /brand has none
 * beyond the build, so each of its three forms is rendered once per isolate.
 */

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
    );
  }),
);

export const pageRoutes = Layer.mergeAll(brand);
