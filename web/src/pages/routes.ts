import { About } from "allthings-core/src/about.ts";
import { asOf } from "allthings-core/src/clock.ts";
import type { DataSourceError } from "allthings-core/src/errors.ts";
import { Evenings } from "allthings-core/src/evenings.ts";
import { EventPages } from "allthings-core/src/event-page.ts";
import { Community } from "allthings-core/src/community.ts";
import { Home } from "allthings-core/src/home.ts";
import { httpUrlOrNull } from "allthings-core/src/mappers.ts";
import {
  type ExternalTalk,
  ExternalTalks,
} from "allthings-core/src/external-talks.ts";
import {
  PeopleDirectory,
  type PersonLookup,
} from "allthings-core/src/people-directory.ts";
import { Portraits, type PortraitsById } from "allthings-core/src/portraits.ts";
import { Redirects } from "allthings-core/src/redirects.ts";
import { sharedPrefix } from "allthings-core/src/short-slugs.ts";
import { Duration, Effect, Layer, Option } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import { CacheControl } from "../cache.ts";
import { type Repositories, repositories } from "../database.ts";
import { Images } from "../images/route.ts";
import {
  aboutPath,
  eventPath,
  hosts,
  mediaOrigin,
  personPath,
} from "../links.ts";
import { Site } from "../site.ts";
import { aboutPage } from "./about.tsx";
import { calendarFile, calendarFileName } from "./calendar.ts";
import { codeOfConductPage, codeOfConductPath } from "./code-of-conduct.tsx";
import { eventPage, eventUnavailablePage, notFoundPage } from "./event.tsx";
import { eventsPage } from "./events.tsx";
import { homePage, unavailablePage } from "./home.tsx";
import { variantPath } from "./lab/paths.ts";
import { gatheringTitle } from "./metadata.tsx";
import { peoplePage } from "./people.tsx";
import { personPage } from "./person.tsx";
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
export const footer = <R>(
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
export const hostPortraits = Portraits.use((repository) =>
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

/** A person found, with the talks they gave elsewhere; or where they went, or no one. */
type PersonView =
  | Exclude<PersonLookup, { readonly kind: "found" }>
  | (Extract<PersonLookup, { readonly kind: "found" }> & {
      readonly elsewhere: ReadonlyArray<ExternalTalk>;
    });

/**
 * /people/<slug>: one person's page, cached like the people page. A slug
 * they had before (their name changed) redirects to the current one for
 * good; one no one has is not found, cached briefly. The person and the
 * hosts' portraits are read at once, over the request's pool.
 */
const person = page(
  "/people/:slug",
  ({ theme, acceptEncoding, params, images }) =>
    Effect.gen(function* () {
      const { origin } = yield* Site;
      const slug = params["slug"] ?? "";
      const path = personPath(slug);
      return yield* Effect.all(
        [
          // The person, and the talks they gave elsewhere.
          PeopleDirectory.use((repository) =>
            repository.person(slug, mediaOrigin),
          ).pipe(
            Effect.flatMap(
              (
                found,
              ): Effect.Effect<PersonView, DataSourceError, ExternalTalks> =>
                found.kind === "found"
                  ? ExternalTalks.use((talks) =>
                      talks.forProfiles([found.person.id]),
                    ).pipe(
                      Effect.map((byProfile) => ({
                        ...found,
                        elsewhere: byProfile.get(found.person.id) ?? [],
                      })),
                    )
                  : Effect.succeed(found),
            ),
          ),
          footer(hostPortraits),
        ],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.provide(repositories),
        Effect.timed,
        Effect.map(([took, [found, { portraits, read }]]) => {
          const db = Duration.toMillis(took);
          if (found.kind === "moved") {
            return HttpServerResponse.redirect(personPath(found.slug), {
              status: 301,
              headers: { "cache-control": CacheControl.page },
            });
          }
          if (found.kind === "none") {
            return htmlResponse(
              notFoundPage({
                origin,
                path,
                theme,
                portraits,
                images,
                person: true,
              }),
              acceptEncoding,
              {
                cacheControl: read ? "notFound" : "failure",
                theme,
                images,
                status: 404,
                db,
              },
            );
          }
          return htmlResponse(
            personPage({
              person: found.person,
              elsewhere: found.elsewhere,
              origin,
              theme,
              portraits,
              images,
            }),
            acceptEncoding,
            {
              cacheControl: read ? "publicData" : "failure",
              theme,
              images,
              db,
            },
          );
        }),
        Effect.catchCause((cause) =>
          Effect.logError("Error rendering a person's page:", cause).pipe(
            Effect.as(
              htmlResponse(
                unavailablePage({
                  origin,
                  path,
                  theme,
                  images,
                  said: "This person’s page didn’t load. Try again in a minute.",
                }),
                acceptEncoding,
                { cacheControl: "failure", theme, images, status: 503 },
              ),
            ),
          ),
        ),
      );
    }),
  (params) => personPath(params["slug"] ?? ""),
);

/**
 * The about page: what allthings is, what it has done so far and where it
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
 * The home lab (pages/lab/), loaded when one of its pages is first asked
 * for, so no other page's cold start parses it, as /brand is.
 */
const labPages = Effect.promise(() => import("./lab/variants.tsx"));

/**
 * /lab: the lab's root, every exploration with its line. It reads only the
 * hosts' portraits, and is cached as a page, as /brand is.
 */
const labRootIndex = page("/lab", ({ theme, acceptEncoding, images }) =>
  Effect.gen(function* () {
    const { origin } = yield* Site;
    const { labRootPage } = yield* Effect.promise(
      () => import("./lab/labs.tsx"),
    );
    const { portraits, read } = yield* footer(
      hostPortraits.pipe(Effect.provide(repositories)),
    );
    return htmlResponse(
      labRootPage({ origin, theme, portraits, images }),
      acceptEncoding,
      { cacheControl: read ? "page" : "failure", theme, images },
    );
  }),
);

/**
 * /lab/home: the home lab's index. It reads only the hosts' portraits, and is
 * cached as a page, as /brand is.
 */
const labIndex = page("/lab/home", ({ theme, acceptEncoding, images }) =>
  Effect.gen(function* () {
    const { origin } = yield* Site;
    const { labIndexPage } = yield* labPages;
    const { portraits, read } = yield* footer(
      hostPortraits.pipe(Effect.provide(repositories)),
    );
    return htmlResponse(
      labIndexPage({ origin, theme, portraits, images }),
      acceptEncoding,
      { cacheControl: read ? "page" : "failure", theme, images },
    );
  }),
);

/**
 * /lab/home/<variant>: a whole home page under one of the lab's heroes,
 * reading home and the community (core's src/community.ts) at once with
 * the hosts' portraits, and cached like home. A name that is no variant is
 * not found; when the data can't be read, the page says so plainly (503).
 */
const labVariant = page(
  "/lab/home/:variant",
  (request) =>
    Effect.gen(function* () {
      const { theme, acceptEncoding, images, params } = request;
      const { origin } = yield* Site;
      const { variantNamed, variantPage } = yield* labPages;
      const name = params["variant"] ?? "";
      const variant = variantNamed(name);
      const path = variantPath(name);
      if (variant === undefined) return yield* nothingAt(path, 404, request);
      return yield* Effect.all(
        [
          Effect.all(
            {
              home: Home.use((repository) => repository.read(mediaOrigin)),
              community: Community.use((repository) =>
                repository.read(mediaOrigin),
              ),
            },
            { concurrency: "unbounded" },
          ),
          footer(hostPortraits),
        ],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.provide(repositories),
        Effect.timed,
        Effect.map(([took, [data, { portraits, read }]]) =>
          htmlResponse(
            variantPage(variant, data, { origin, theme, portraits, images }),
            acceptEncoding,
            {
              cacheControl: read ? "publicData" : "failure",
              theme,
              db: Duration.toMillis(took),
              images,
              scripts: variant.scripted === true,
            },
          ),
        ),
        Effect.catchCause((cause) =>
          Effect.logError(
            `Error rendering the home lab's ${name}:`,
            cause,
          ).pipe(
            Effect.as(
              htmlResponse(
                unavailablePage({ origin, path, theme, images }),
                acceptEncoding,
                { cacheControl: "failure", theme, images, status: 503 },
              ),
            ),
          ),
        ),
      );
    }),
  (params) => variantPath(params["variant"] ?? ""),
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

/**
 * Where an event's routes are: at the root, and a shared evening's link
 * under shared/ (core's src/short-slugs.ts).
 */
type EventPrefix = "" | typeof sharedPrefix;

/** The slug a route's parameters name, under `prefix`. */
const slugAt = (prefix: EventPrefix, params: PageRequest["params"]) =>
  `${prefix}${params["slug"] ?? ""}`;

/** The event at `slug`, or none when no published event has it. */
const readEvent = (slug: string) =>
  EventPages.use((pages) => pages.read(slug, mediaOrigin)).pipe(
    Effect.map(Option.some),
    Effect.catchTag("EventNotFound", () => Effect.succeedNone),
  );

/**
 * /<slug>: an evening's page at its short link (/effect, or
 * /shared/<name> for an evening we share), cached like the home page. At
 * any other slug of the evening (its long one, or a link it had before) it
 * redirects there for good: those are linked from Luma, posts and QR codes.
 * Drafts and unknown slugs are not found, which is cached only briefly: a
 * draft may be published at any moment. The event and the hosts' portraits
 * are read at once, over the request's pool.
 */
const eventAt = (prefix: EventPrefix) =>
  page(
    `/${prefix}:slug`,
    ({ theme, acceptEncoding, params, images }) =>
      Effect.gen(function* () {
        const { origin } = yield* Site;
        const slug = slugAt(prefix, params);
        const path = eventPath(slug);
        return yield* Effect.all([readEvent(slug), footer(hostPortraits)], {
          concurrency: "unbounded",
        }).pipe(
          Effect.provide(repositories),
          Effect.timed,
          Effect.bindTo("timed"),
          Effect.bind("now", () => asOf),
          Effect.map(({ timed: [took, [found, { portraits, read }]], now }) => {
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
                view.slug !== slug
                  ? HttpServerResponse.redirect(eventPath(view.slug), {
                      status: 301,
                      headers: { "cache-control": CacheControl.publicData },
                    })
                  : htmlResponse(
                      eventPage({
                        event: view,
                        origin,
                        theme,
                        portraits,
                        images,
                        now,
                      }),
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
    (params) => eventPath(slugAt(prefix, params)),
  );

/** A plain-text answer, for the files and redirects pages link to. */
const plain = (text: string, status: number, cacheControl: CacheControl) =>
  HttpServerResponse.text(text, {
    status,
    headers: { "cache-control": cacheControl },
  });

/**
 * /<slug>/calendar.ics: "add to calendar" for the event at `slug` (any of
 * its slugs, as its page), cached like its page.
 */
const calendarAt = (prefix: EventPrefix) =>
  HttpRouter.add(
    "GET",
    `/${prefix}:slug/calendar.ics`,
    Effect.gen(function* () {
      const slug = slugAt(prefix, yield* HttpRouter.params);
      const { origin } = yield* Site;
      const found = yield* readEvent(slug).pipe(Effect.provide(repositories));
      return Option.match(found, {
        onNone: () => plain("Event not found", 404, CacheControl.notFound),
        onSome: (view) =>
          HttpServerResponse.text(calendarFile(view, origin), {
            contentType: "text/calendar; charset=utf-8",
            headers: {
              "cache-control": CacheControl.publicData,
              "content-disposition": `attachment; filename="${calendarFileName(view.slug)}"`,
            },
          }),
      });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Error building a calendar file:", cause).pipe(
          Effect.as(
            plain("Temporarily unavailable", 503, CacheControl.failure),
          ),
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
 * Sign-in (Stack Auth), members' profiles and the admin, which the current
 * site served and the Worker never will: retired with it (410).
 */
export const retiredSignInPaths = [
  "/profile",
  "/handler/*",
  // "/admin/*" is /admin too.
  "/admin/*",
  "/api/v1/profile",
  "/api/v1/admin/*",
] as const;

/**
 * What a retired sign-in, profile or admin path answers: a short plain page
 * that leads to the home page. It reads nothing, so it never fails.
 */
export const retiredSignInPage = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${gatheringTitle("gone")}</title>
<h1>Gone</h1>
<p>Sign-in, profiles and the admin were retired with the old site.</p>
<p><a href="/">Go to the home page</a></p>
</html>
`;

/**
 * The retired sign-in, profile and admin paths, for every method: the old
 * site's cutover redirect sends a POST or a DELETE on with a 308, and it
 * finds them gone too.
 */
const retiredSignIn = retiredSignInPaths.map((route) =>
  HttpRouter.add(
    "*",
    route,
    HttpServerResponse.text(retiredSignInPage, {
      status: 410,
      contentType: "text/html; charset=utf-8",
      headers: { "cache-control": CacheControl.page },
    }),
  ),
);

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
  person,
  speakers,
  about,
  labRootIndex,
  labIndex,
  labVariant,
  brand,
  codeOfConduct,
  eventAt(""),
  eventAt(sharedPrefix),
  calendarAt(""),
  calendarAt(sharedPrefix),
  shortLink,
  nextImage,
  ...retired,
  ...retiredSignIn,
  elsewhere,
);
