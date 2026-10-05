import { Effect, Layer } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { CacheControl } from "../cache.ts";
import { repositories } from "../database.ts";
import { rssPath } from "../pages/metadata.tsx";
import { Site } from "../site.ts";
import { FeedData, type FeedEvent } from "./data.ts";
import { robotsTxt } from "./robots.ts";
import { rssXml } from "./rss.ts";
import { sitemapXml } from "./sitemap.ts";

/**
 * What crawlers and feed readers read, at the paths the current site
 * serves them, so that search engines and subscribers carry over:
 * /robots.txt, /sitemap.xml, /rss, and /rss.xml, which redirects to /rss
 * for good as it does today.
 */

const text = (body: string, contentType: string, cacheControl: CacheControl) =>
  HttpServerResponse.text(body, {
    contentType,
    headers: {
      "cache-control": cacheControl,
      "x-content-type-options": "nosniff",
    },
  });

/**
 * robots.txt for the host the request reached (see robots.ts). It changes
 * only with deploys and differs only by host, which caches key on anyway.
 */
const robots = HttpRouter.add(
  "GET",
  "/robots.txt",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const { origin } = yield* Site;
    return text(
      robotsTxt(request.originalUrl, origin),
      "text/plain; charset=utf-8",
      CacheControl.page,
    );
  }),
);

/**
 * An XML document made from every published event, cached like the API's
 * public data. When the events can't be read, the answer says so with 503,
 * which crawlers take as "try again later", and is never stored.
 */
const document = (
  path: `/${string}`,
  contentType: string,
  render: (events: ReadonlyArray<FeedEvent>, origin: string) => string,
) =>
  HttpRouter.add(
    "GET",
    path,
    Effect.gen(function* () {
      const { origin } = yield* Site;
      const events = yield* FeedData.use((data) => data.listPublished);
      return text(render(events, origin), contentType, CacheControl.publicData);
    }).pipe(
      Effect.provide(repositories),
      Effect.catchCause((cause) =>
        Effect.logError(`Error rendering ${path}:`, cause).pipe(
          Effect.as(
            HttpServerResponse.text("Temporarily unavailable", {
              status: 503,
              headers: { "cache-control": CacheControl.failure },
            }),
          ),
        ),
      ),
    ),
  );

const sitemap = document(
  "/sitemap.xml",
  "application/xml; charset=utf-8",
  sitemapXml,
);

const rss = document(rssPath, "application/rss+xml; charset=utf-8", rssXml);

/** The feed's old address, as app/src/app/rss.xml/route.ts redirects it. */
const rssXmlRedirect = HttpRouter.add(
  "GET",
  "/rss.xml",
  HttpServerResponse.redirect(rssPath, {
    status: 301,
    headers: { "cache-control": CacheControl.page },
  }),
);

export const seoRoutes = Layer.mergeAll(robots, sitemap, rss, rssXmlRedirect);
