/**
 * The cutover's last step (infra/docs/r2-migration.md, "Later: the full
 * cutover"): with it on, this site answers every request with a redirect to
 * the same thing on allthings.dev, where the new site serves it. It ships
 * off; src/middleware.ts turns it on when `ALLTHINGS_DEV_REDIRECT` is "on"
 * (config.ts).
 *
 * Where the new site would only redirect again, the redirect goes straight
 * there, so each old URL takes one hop:
 * - an event's long slug goes to its short link (`/2025-01-28-…` to
 *   `/web-2025-01`), looked up in the database;
 * - `/speakers` to `/people`, `/rss.xml` to `/rss`, a path with a trailing
 *   slash to the path without it;
 * - the old link-preview images to the new site's cards (`/og/…`);
 * - Next's image optimizer, for a photo on the media origin, to the photo.
 *
 * Everything else goes to the same path and query on allthings.dev, which
 * answers it as the legacy-URL manifest (web/tests/support/legacy-urls.ts)
 * says: the API and MCP, short links and feeds, and the paths it retires.
 * web/tests/cutover.test.ts holds every pattern in the manifest to it.
 *
 * GET and HEAD get a 301. Any other method gets a 308, which keeps the
 * method and body, so a POST to /mcp or the API still arrives as one.
 *
 * A fragment never reaches a server: the browser keeps it across the
 * redirect. So `/people#p-<id>` lands on allthings.dev/people#p-<id>, where
 * the new people page keeps each person's anchor (web/src/links.ts).
 *
 * Pure: no imports, so the new site's tests can run it too.
 */

/** Where the site now lives. */
export const newOrigin = "https://allthings.dev";

/** Where photos are served from, which Next's optimizer only ever resized. */
export const mediaOrigin = "https://media.allthings.dev";

/** A shared evening's short link starts with this (core's src/short-slugs.ts). */
const sharedPrefix = "shared/";

/**
 * How long browsers and caches keep a cutover redirect: an hour, so turning
 * the flag back off takes hold within one (a bare 301 is kept for good).
 */
export const cutoverCacheControl = "public, max-age=3600";

/** What a request is answered with. */
export interface CutoverRedirect {
  readonly status: 301 | 308;
  readonly location: string;
}

/**
 * An event's short link as a path, encoded so it stays one segment, two for
 * a shared evening's: as core's eventPathOf (src/mappers.ts) writes it.
 */
export function shortLinkPath(link: string): string {
  return link.startsWith(sharedPrefix) && link.length > sharedPrefix.length
    ? `/${sharedPrefix}${encodeURIComponent(link.slice(sharedPrefix.length))}`
    : `/${encodeURIComponent(link)}`;
}

/** The link-preview images the new site's cards replace, by path. */
const cards: Readonly<Record<string, string>> = {
  "/api/v1/preview.png": "/og/home.png",
  "/api/v1/speakers.png": "/og/people.png",
};

/**
 * The site's own top-level pages and endpoints, which are never an event's
 * long slug, so they are never looked up (a file, with a ".", isn't either).
 */
const ownPaths: ReadonlySet<string> = new Set([
  "about",
  "admin",
  "api",
  "code-of-conduct",
  "handler",
  "mcp",
  "monitoring",
  "people",
  "profile",
  "r",
  "rss",
  "sentry-example-page",
  "shared",
]);

/** How long a lookup may take before the redirect goes on without it. */
export const lookupTimeout = 1500;

/**
 * `shortLink(slug)`, or null when it throws, rejects or takes longer than
 * {@link lookupTimeout}: a lookup only saves a hop, so it never holds the
 * redirect up.
 */
const lookup = (
  shortLink: (longSlug: string) => Promise<string | null>,
  slug: string,
): Promise<string | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve()
      .then(() => shortLink(slug))
      .catch(() => null),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), lookupTimeout);
    }),
  ]).finally(() => clearTimeout(timer));
};

/** Paths the new site renamed, by their old name. */
const renamed: Readonly<Record<string, string>> = {
  "/speakers": "/people",
  "/rss.xml": "/rss",
};

/**
 * Where a request for `pathname` and `search` (with its "?", or "") goes on
 * allthings.dev. `shortLink` gives a published event's short link from its
 * long slug, or null; it is asked only of a path of one segment.
 */
export async function cutoverRedirect(
  request: {
    readonly method: string;
    readonly pathname: string;
    readonly search: string;
  },
  shortLink: (longSlug: string) => Promise<string | null>,
): Promise<CutoverRedirect> {
  const { method, search } = request;
  const same = (pathname: string, query = search): CutoverRedirect => ({
    status: method === "GET" || method === "HEAD" ? 301 : 308,
    location: `${newOrigin}${pathname}${query}`,
  });
  if (method !== "GET" && method !== "HEAD") {
    return same(request.pathname);
  }

  // A trailing slash goes, as the new site would take it off.
  const pathname =
    request.pathname.length > 1 && request.pathname.endsWith("/")
      ? request.pathname.replace(/\/+$/, "") || "/"
      : request.pathname;

  const renamedTo = renamed[pathname];
  if (renamedTo !== undefined) return same(renamedTo);

  const card = cards[pathname];
  if (card !== undefined) return same(card, "");
  const eventCard = /^\/api\/v1\/([^/]+)\/(?:preview|thumbnail)\.png$/.exec(
    pathname,
  );
  if (eventCard !== null) return same(`/og/${eventCard[1]}.png`, "");

  if (pathname === "/_next/image") {
    const url = new URLSearchParams(search).get("url");
    if (url !== null && url.startsWith(`${mediaOrigin}/`)) {
      return { status: 301, location: url };
    }
    return same(pathname);
  }

  // One segment may be an event's long slug, which has a short link now.
  const single = /^\/([^/]+)$/.exec(pathname);
  if (single !== null) {
    let slug: string;
    try {
      slug = decodeURIComponent(single[1] ?? "");
    } catch {
      return same(pathname);
    }
    if (!slug.includes(".") && !ownPaths.has(slug)) {
      const link = await lookup(shortLink, slug);
      if (link !== null && link !== slug) return same(shortLinkPath(link));
    }
  }
  return same(pathname);
}
