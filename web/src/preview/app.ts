import { asOf } from "allthings-core/src/clock.ts";
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
import {
  Collab,
  collabLayer,
  collabUrl,
  type Evening,
  type Signer,
} from "./collab.ts";
import { CollabPanel } from "./panel.tsx";

/**
 * The draft preview: an evening's real page, rendered from its draft,
 * for the organizers alone (infra/src/preview.ts puts Cloudflare Access in
 * front of it, and access.ts checks what Access signed). It is its own
 * Worker: the public one never reads a draft (core's EventPages.read only
 * finds published evenings), and this one reads nothing but drafts.
 *
 * - `/` lists the drafts, soonest first, for an organizer; for an invited
 *   collaborator, the evenings they are invited to.
 * - `/<slug>` is the draft's page, exactly as the public page will be,
 *   with the collaborators' panel under it (panel.tsx). A collaborator
 *   sees only the evenings they are invited to, drafts or published; any
 *   other slug answers as one that doesn't exist does.
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

/** Who Access signed in for this request (access.ts), set by the handler. */
export class CurrentSigner extends Context.Reference<Option.Option<Signer>>(
  "allthings/web/preview/CurrentSigner",
  { defaultValue: () => Option.none() },
) {}

/** Where collaboration is read (collab.ts), from the Worker's bindings. */
export class CollabDatabase extends Context.Reference<Option.Option<string>>(
  "allthings/web/preview/CollabDatabase",
  { defaultValue: () => Option.none() },
) {}

/** The signer, who the handler always sets before routing. */
const signer = Effect.gen(function* () {
  const current = yield* CurrentSigner;
  if (Option.isNone(current)) {
    return yield* Effect.die("the preview routed a request nobody signed");
  }
  return current.value;
});

/** `f` over the request's collaboration reads; none when the Worker has no `COLLAB` binding. */
const withCollab = <A, E, R>(
  f: (collab: Collab["Service"]) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const url = yield* CollabDatabase;
    if (Option.isNone(url)) return Option.none<A>();
    return Option.some(
      yield* Collab.use(f).pipe(Effect.provide(collabLayer(url.value))),
    );
  });

/** What a signer who may see nothing is told, here and before routing alike. */
export const refusal =
  "Only the organizers and the people they invite can see drafts.";

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
    const who = yield* signer;
    const drafts = yield* Drafts.use((list) => list.list).pipe(
      Effect.provide(preview),
    );
    if (!who.organizer) {
      const invited = Option.getOrElse(
        yield* withCollab((collab) => collab.evenings(who)),
        () => [] as ReadonlyArray<Evening>,
      );
      if (invited.length === 0) {
        return HttpServerResponse.text(refusal, { status: 403 });
      }
      const names = new Map(drafts.map((draft) => [draft.slug, draft.name]));
      const rows = invited
        .map(
          (evening) =>
            `<li><a href="/${encodeURIComponent(evening.slug)}">${escape(names.get(evening.slug) ?? evening.slug)}</a></li>`,
        )
        .join("");
      return HttpServerResponse.text(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Your evenings · allthings</title></head><body><main><h1>Your evenings</h1><ul>${rows}</ul></main></body></html>`,
        { contentType: "text/html; charset=utf-8" },
      );
    }
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
    const who = yield* signer;
    // Which evening this is to the signer: one they are invited to (or, for
    // an organizer, a draft or an evening with collaborators), or none.
    const evening = Option.flatten(
      yield* withCollab((collab) => collab.evening(who, slug)),
    );
    // A collaborator asking for any other evening is told what a slug
    // nobody has is told: it is the public site's.
    if (!who.organizer && Option.isNone(evening)) {
      return yield* toPublic(request.url);
    }
    const read = (draft: boolean) =>
      EventPages.use((pages) =>
        draft
          ? pages.readDraft(slug, mediaOrigin)
          : pages.read(slug, mediaOrigin),
      ).pipe(
        Effect.map(Option.some),
        Effect.catchTag("EventNotFound", () => Effect.succeedNone),
      );
    const [found, { portraits }] = yield* Effect.all(
      [
        read(
          Option.match(evening, {
            onNone: () => true,
            onSome: (e) => e.isDraft,
          }),
        ),
        footer(hostPortraits),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.provide(preview));
    // Not a draft, nor an evening with collaborators: a published evening,
    // or a page of the site, is the public site's to show.
    if (Option.isNone(found)) return yield* toPublic(request.url);
    const panel = Option.isNone(evening)
      ? Option.none()
      : yield* withCollab((collab) => collab.panel(who, evening.value));
    const now = yield* asOf;
    return htmlResponse(
      eventPage({
        event: found.value,
        origin,
        theme,
        portraits,
        images,
        now,
        ...(Option.isSome(panel)
          ? { after: CollabPanel({ panel: panel.value }) }
          : {}),
      }),
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
        Layer.succeed(CollabDatabase, collabUrl(env)),
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
    if (!verdict.allowed) return answer(refusal, 403);
    const signed = Context.make(
      CurrentSigner,
      Option.some({ email: verdict.email, organizer: verdict.organizer }),
    );
    const response = await handler(
      request,
      context === undefined
        ? signed
        : Context.add(signed, WaitUntil, (promise) =>
            context.waitUntil(promise),
          ),
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
