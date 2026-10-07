import { Drafts } from "allthings-core/src/drafts.ts";
import { DataSourceError } from "allthings-core/src/errors.ts";
import { EventPages } from "allthings-core/src/event-page.ts";
import { Portraits } from "allthings-core/src/portraits.ts";
import {
  Config,
  ConfigProvider,
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
} from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Hyperdrive, pool } from "../database.ts";
import { imageRoutes, Images, WaitUntil } from "../images/route.ts";
import { mediaOrigin } from "../links.ts";
import { Assets } from "../og/route.ts";
import { eventPage } from "../pages/event.tsx";
import { footer, hostPortraits } from "../pages/routes.ts";
import { htmlResponse } from "../pages/response.ts";
import { themeOf } from "../pages/theme.ts";
import { Site } from "../site.ts";
import {
  type AccessSettings,
  accessSettings,
  type KeySource,
  publishedKeys,
  verifyAccess,
} from "./access.ts";

/**
 * The draft preview: an evening's real page, rendered from its draft,
 * for the organizers alone (infra/src/preview.ts puts Cloudflare Access in
 * front of it, and access.ts checks what Access signed). It is its own
 * Worker: the public one never reads a draft (core's EventPages.read only
 * finds published evenings), and this one reads nothing but drafts.
 *
 * - `/` lists the drafts, soonest first.
 * - `/<slug>` is the draft's page, exactly as the public page will be.
 * - `/img/…` serves the photos' variants, as the site does.
 * - Anything else the page links to (the evenings, people, about) is the
 *   public site's: it redirects there.
 *
 * Every answer is `no-store` and `noindex`: a draft is never cached or
 * crawled anywhere.
 */

const preview = Layer.effectContext(
  Layer.build(
    Layer.mergeAll(EventPages.layer, Drafts.layer, Portraits.layer).pipe(
      Layer.provide(pool),
    ),
  ).pipe(Effect.mapError((cause) => new DataSourceError({ cause }))),
);

const day = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const escape = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** The list of drafts, as plain as a page gets. */
const index = HttpRouter.add(
  "GET",
  "/",
  Effect.gen(function* () {
    const drafts = yield* Drafts.use((list) => list.list).pipe(
      Effect.provide(preview),
    );
    const items = drafts
      .map(
        (draft) =>
          `<li><a href="/${encodeURIComponent(draft.slug)}">${escape(draft.name)}</a> · ${escape(day.format(DateTime.toDateUtc(draft.startDate)))}</li>`,
      )
      .join("");
    return HttpServerResponse.text(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Drafts · allthings</title></head><body><main><h1>Drafts</h1>${items === "" ? "<p>No drafts.</p>" : `<ul>${items}</ul>`}</main></body></html>`,
      { contentType: "text/html; charset=utf-8" },
    );
  }),
);

/** `url`'s path and query on the public site (`PUBLIC_URL`). */
const toPublic = (url: string) =>
  Effect.gen(function* () {
    const base = (yield* Config.String("PUBLIC_URL")).replace(/\/+$/, "");
    const { pathname, search } = new URL(url, "http://localhost");
    return HttpServerResponse.redirect(`${base}${pathname}${search}`, {
      status: 302,
    });
  });

/** A draft's page, exactly as the public one will render it. */
const draftPage = HttpRouter.add(
  "GET",
  "/:slug",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const { slug = "" } = yield* HttpRouter.params;
    const { origin } = yield* Site;
    const theme = themeOf(request.cookies);
    const images = Option.isSome(yield* Images) ? "variants" : "originals";
    const acceptEncoding = request.headers["accept-encoding"];
    const [found, { portraits }] = yield* Effect.all(
      [
        EventPages.use((pages) => pages.readDraft(slug, mediaOrigin)).pipe(
          Effect.map(Option.some),
          Effect.catchTag("EventNotFound", () => Effect.succeedNone),
        ),
        footer(hostPortraits),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.provide(preview));
    // Not a draft: a published evening, or a page of the site, is the
    // public site's to show.
    if (Option.isNone(found)) return yield* toPublic(request.url);
    const now = yield* DateTime.now;
    return htmlResponse(
      eventPage({ event: found.value, origin, theme, portraits, images, now }),
      acceptEncoding,
      { cacheControl: "failure", theme, images },
    );
  }),
);

/** Everything else a page links to is the public site's. */
const elsewhere = HttpRouter.add(
  "GET",
  "/*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return yield* toPublic(request.url);
  }),
);

/** What every preview answer carries. */
export const previewHeaders = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
} as const;

const answer = (text: string, status: number): Response =>
  new Response(text, {
    status,
    headers: { ...previewHeaders, "content-type": "text/plain; charset=utf-8" },
  });

/** What the preview handler may be given instead of the real thing, for tests. */
export interface PreviewOptions {
  readonly keys?: KeySource;
  readonly now?: () => number;
}

/** The request's context, as the Worker passes it. */
export interface ExecutionContext {
  readonly waitUntil: (promise: Promise<unknown>) => void;
}

/**
 * The preview Worker as a fetch handler, built once per isolate from its
 * bindings. Each request's Access token is checked first; nothing is read
 * before it passes.
 */
export function makePreviewHandler(
  env: Readonly<Record<string, unknown>>,
  options: PreviewOptions = {},
): (request: Request, context?: ExecutionContext) => Promise<Response> {
  const settings: AccessSettings | string = accessSettings(env);
  const keys = options.keys ?? publishedKeys();
  const now = options.now ?? Date.now;
  const services = Site.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ConfigProvider.layer(ConfigProvider.fromUnknown(env)),
        Hyperdrive.layer(env),
        Images.layer(env),
        Assets.layer(env),
      ),
    ),
  );
  const { handler } = HttpRouter.toWebHandler(
    Layer.mergeAll(index, imageRoutes, draftPage, elsewhere).pipe(
      Layer.provideMerge(services),
    ),
    { disableLogger: true, routerConfig: { ignoreTrailingSlash: false } },
  );
  return async (request, context) => {
    if (typeof settings === "string") {
      console.error(`Draft preview refuses everyone: ${settings}`);
      return answer("The draft preview isn't configured.", 503);
    }
    const verdict = await verifyAccess(
      request.headers.get("cf-access-jwt-assertion"),
      settings,
      keys,
      now(),
    ).catch((cause: unknown) => ({
      allowed: false as const,
      reason: `could not check: ${cause instanceof Error ? cause.message : String(cause)}`,
    }));
    if (!verdict.allowed) {
      return answer("Only the organizers can see drafts.", 403);
    }
    const response =
      context === undefined
        ? await handler(request)
        : await handler(
            request,
            Context.make(WaitUntil, (promise) => context.waitUntil(promise)),
          );
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(previewHeaders)) {
      headers.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
