import { mediaOrigin } from "../../src/links.ts";
import { longSlugs, redirects, slugs } from "./event-catalog.ts";

/**
 * Every URL the current site (allthingsweb.dev, the Next app in app/)
 * answers, and what the Worker does with it after the cutover. Gathered
 * from the app's route tree (app/src/app/**), its public files
 * (app/public/**), its sitemap, robots.txt and feeds, the redirects table,
 * and the live site's sitemap and pages' head (2026-10-05). Nothing in the
 * database or the Luma calendar's descriptions links to the site.
 *
 * tests/legacy-urls.test.ts asks the Worker for each example, against the
 * event catalog (support/event-catalog.ts), and holds it to `worker`. It
 * also finds an entry for every route in the app's tree and every file in
 * app/public, so one the app adds without an entry here fails it.
 */

/** What the Worker answers. */
export type WorkerAnswer =
  | {
      readonly status: 200;
      /** The start of its Content-Type. */
      readonly type: string;
    }
  | {
      readonly status: 301 | 307 | 308;
      readonly location: string;
    }
  | { readonly status: 400 | 404 | 405 | 410 };

interface Entry {
  /**
   * The URL as the current site names it: `[name]` is one segment, `*` and
   * `[...name]` any number, and what follows " (" says which of them.
   * Alternatives are separated by ", ".
   */
  readonly pattern: string;
  /** Where it comes from. */
  readonly source: string;
  /** A concrete request for it. */
  readonly example: string;
  readonly worker: WorkerAnswer;
}

export type LegacyUrl = Entry &
  (
    | {
        /** What the current site answers, when it is not a plain 200. */
        readonly today?: string;
        readonly pending?: undefined;
      }
    | {
        readonly today: string;
        /**
         * Not decided yet: what the organizers are to decide. Until then the
         * Worker answers as `worker` says.
         */
        readonly pending: string;
      }
  );

const html = { status: 200, type: "text/html" } as const;
const json = { status: 200, type: "application/json" } as const;
const png = { status: 200, type: "image/png" } as const;
const notFound = { status: 404 } as const;
const gone = { status: 410 } as const;

export const legacyUrls: ReadonlyArray<LegacyUrl> = [
  // Pages
  { pattern: "/", source: "app route, sitemap", example: "/", worker: html },
  {
    pattern: "/about",
    source: "app route, sitemap",
    example: "/about",
    worker: html,
  },
  {
    pattern: "/code-of-conduct",
    source: "app route, sitemap, MCP get_community",
    example: "/code-of-conduct",
    worker: html,
  },
  {
    pattern: "/speakers",
    source: "app route, sitemap",
    example: "/speakers",
    worker: { status: 301, location: "/people" },
    today: "200, the speakers list",
  },
  // An evening's long slug is linked from Luma's descriptions, posts and
  // QR codes: it leads to the evening's short link for good (core's
  // src/short-slugs.ts), or is the page while the evening has none.
  {
    pattern: "/[slug]",
    source: "app route, sitemap, RSS items",
    example: `/${longSlugs.past}`,
    worker: { status: 301, location: `/${slugs.past}` },
    today: "200, the event's page",
  },
  {
    pattern:
      "/2024-10-05-hackathon-at-sentry, /2025-04-26-hackathon-at-sentry, /2025-09-23-lightning-hackathon-at-sentry, /2024-12-03-all-things-web-at-convex, /2025-06-02-nextdevfm-live",
    source: "app routes with pages of their own",
    example: `/${longSlugs.hackathon}`,
    worker: { status: 301, location: `/${slugs.hackathon}` },
    // Their schedules, awards, themes and the rest are the event's
    // schedule and notes (core/backfill/event-extras.json).
    today: "their own pages: schedules, prizes, themes, teams",
  },
  // A shared evening's short link (core's src/short-slugs.ts): the app
  // sends it to the evening's page until allthings.dev serves it.
  {
    pattern: "/shared/[slug]",
    source: "app route, promotion drafts",
    example: `/${slugs.shared}`,
    worker: html,
    today: "308 to the evening's long slug",
  },
  {
    pattern: "/[slug] (a draft, or no event)",
    source: "app route",
    example: `/${longSlugs.draft}`,
    worker: notFound,
    today: "404",
  },
  {
    pattern: "/[page]/ (a trailing slash)",
    source: "Next's trailing-slash redirect",
    example: "/about/",
    worker: { status: 308, location: "/about" },
    today: "308 to the path without it",
  },
  {
    pattern: "/r/[id]",
    source: "app route, redirects table",
    example: "/r/discord",
    worker: { status: 307, location: redirects.discord },
    today: "307 to its destination",
  },
  // Feeds and files for machines
  {
    pattern: "/rss",
    source: "app route, every page's head",
    example: "/rss",
    worker: { status: 200, type: "application/rss+xml" },
  },
  {
    pattern: "/rss.xml",
    source: "app route",
    example: "/rss.xml",
    worker: { status: 301, location: "/rss" },
  },
  {
    pattern: "/sitemap.xml",
    source: "app route, robots.txt",
    example: "/sitemap.xml",
    worker: { status: 200, type: "application/xml" },
  },
  {
    pattern: "/robots.txt",
    source: "app route",
    example: "/robots.txt",
    worker: { status: 200, type: "text/plain" },
  },
  {
    pattern: "/manifest.webmanifest",
    source: "app/src/app/manifest.ts, every page's head",
    example: "/manifest.webmanifest",
    worker: { status: 200, type: "application/manifest+json" },
  },
  {
    pattern: "/favicon.ico",
    source: "app/public, every page's head",
    example: "/favicon.ico",
    worker: { status: 200, type: "image/" },
  },
  ...[
    "/favicon-16.png",
    "/favicon-32.png",
    "/apple-touch-icon.png",
    "/android-chrome-192.png",
    "/android-chrome-512.png",
  ].map(
    (path): LegacyUrl => ({
      pattern: path,
      source: "app/public, every page's head or the manifest",
      example: path,
      worker: png,
    }),
  ),
  {
    pattern: "/brand/*",
    source: "app/public/brand: wordmark, mark, icon, avatar, favicon",
    example: "/brand/wordmark.svg",
    worker: { status: 200, type: "image/svg+xml" },
  },
  {
    pattern: "/_next/image (a photo on the media origin)",
    source: "Next's image optimizer, in search engines and link previews",
    example: `/_next/image?url=${encodeURIComponent(`${mediaOrigin}/events/a.jpg`)}&w=640&q=75`,
    worker: { status: 301, location: `${mediaOrigin}/events/a.jpg` },
    today: "200, the resized photo",
  },
  {
    pattern: "/_next/image (any other url)",
    source: "Next's image optimizer",
    example: `/_next/image?url=${encodeURIComponent("https://elsewhere.example/a.jpg")}&w=640&q=75`,
    worker: notFound,
    today: "400",
  },
  // The public API and MCP
  {
    pattern: "/api/v1/events",
    source: "app route, the CLI",
    example: "/api/v1/events",
    worker: json,
  },
  {
    pattern: "/api/v1/events/[id]",
    source: "app route, the CLI",
    example: "/api/v1/events/e0000000-0000-4000-8000-000000000503",
    worker: json,
  },
  {
    pattern: "/api/v1/speakers",
    source: "app route, the CLI",
    example: "/api/v1/speakers",
    worker: json,
  },
  {
    pattern: "/mcp (GET)",
    source: "app route",
    example: "/mcp",
    worker: { status: 405 },
    today: "405; MCP clients POST",
  },
  // Link-preview cards, drawn in the old brand: the new brand's, for good.
  ...(
    [
      ["/api/v1/preview.png", "the site's link-preview image", "/og/home.png"],
      [
        "/api/v1/[slug]/preview.png",
        "each event's link-preview image",
        `/og/${longSlugs.past}.png`,
      ],
      [
        "/api/v1/[slug]/thumbnail.png",
        "each event's thumbnail",
        `/og/${longSlugs.past}.png`,
      ],
      [
        "/api/v1/speakers.png",
        "the speakers page's link-preview image",
        "/og/people.png",
      ],
    ] as const
  ).map(
    ([pattern, what, location]): LegacyUrl => ({
      pattern,
      source: "app route, every page's og:image",
      example: pattern.replace("[slug]", longSlugs.past),
      worker: { status: 301, location },
      today: `200, ${what}, drawn in the old brand`,
    }),
  ),
  // QR codes, now in the brand's colors (og/qr.ts).
  {
    pattern: "/api/v1/qr.png",
    source: "app route",
    example: "/api/v1/qr.png",
    worker: { status: 400 },
    today: "400 without its parameters",
  },
  {
    pattern: "/api/v1/[slug]/qr.png",
    source: "app route",
    example: `/api/v1/${longSlugs.past}/qr.png`,
    worker: png,
    today: "200, a QR code to the event",
  },
  ...(
    [
      ["/logos/*", "/logos/logo-1.91x1.png"],
      ["/hero-image-*.png", "/hero-image-404.png"],
    ] as const
  ).map(
    ([pattern, example]): LegacyUrl => ({
      pattern,
      source: "app/public",
      example,
      // Images of the old name, retired with it.
      worker: gone,
      today: "200, an image in the old brand",
    }),
  ),
  ...(
    [
      ["/profile", "/profile", "404: the app dropped members' profiles"],
      ["/handler/[...stack]", "/handler/sign-in", "200, Stack Auth's sign-in"],
      ["/admin, /admin/*", "/admin", "404: the app dropped the admin"],
      [
        "/api/v1/profile",
        "/api/v1/profile",
        "404: the app dropped members' profiles",
      ],
      [
        "/api/v1/admin/*",
        "/api/v1/admin/raw/talks",
        "404: the app dropped the admin",
      ],
    ] as const
  ).map(
    ([pattern, example, today]): LegacyUrl => ({
      pattern,
      source: "app route (robots.txt disallows it)",
      example,
      // Sign-in, profiles and the admin, retired with the old site: a short
      // plain page that leads home, for every method (pages/routes.ts).
      worker: gone,
      today,
    }),
  ),
  {
    pattern: "/api/cron/luma-sync",
    source: "app route, Vercel cron",
    example: "/api/cron/luma-sync",
    worker: notFound,
    today: "401 without the cron secret",
    pending:
      "410 at the cutover, when the sync runs as the Worker's cron trigger",
  },
  ...(
    [
      ["/sentry-example-page", "app route, Sentry's example", "200"],
      [
        "/api/sentry-example-api",
        "app route, Sentry's example",
        "500, on purpose",
      ],
      [
        "/monitoring",
        "Sentry's tunnel (next.config.ts)",
        "404 to GET; it takes Sentry's POSTs",
      ],
    ] as const
  ).map(
    ([path, source, today]): LegacyUrl => ({
      pattern: path,
      source,
      example: path,
      // Sentry's leftovers, retired with the app.
      worker: gone,
      today,
    }),
  ),
];

/** Each path `entry`'s pattern names, without what follows " (". */
const alternativesOf = (entry: LegacyUrl): ReadonlyArray<string> =>
  entry.pattern
    .split(", ")
    .map((alternative) => alternative.split(" (")[0] ?? "");

/** "[...name]", any number of segments; "[name]", one. */
const parameterKind = (segment: string) =>
  segment.startsWith("[...") && segment.endsWith("]")
    ? "rest"
    : segment.startsWith("[") && segment.endsWith("]")
      ? "one"
      : undefined;

/**
 * Whether `alternative` names the app route `route` itself: segment by
 * segment, a parameter only where the route has one of its kind (whatever
 * its name), and a final "*" for any routes beneath. So "/[slug]" never
 * stands in for a route of its own, such as "/about".
 */
function namesRoute(alternative: string, route: string): boolean {
  const pattern = alternative.split("/");
  const segments = route.split("/");
  if (pattern.at(-1) === "*") {
    const base = pattern.slice(0, -1);
    return (
      segments.length > base.length &&
      base.every((segment, index) => segment === segments[index])
    );
  }
  return (
    pattern.length === segments.length &&
    pattern.every((segment, index) => {
      const other = segments[index] ?? "";
      const kind = parameterKind(segment);
      return kind === undefined
        ? segment === other
        : kind === parameterKind(other);
    })
  );
}

/** The entry for the app route `route` (as "/api/v1/[slug]/qr.png"), if any. */
export const routeEntryFor = (route: string): LegacyUrl | undefined =>
  legacyUrls.find((entry) =>
    alternativesOf(entry).some((alternative) => namesRoute(alternative, route)),
  );

/**
 * The entry for the file at `path` in app/public, if any: one whose pattern
 * spells it out, "*" standing for any characters, but never a parameter,
 * which names what the database holds, not a file.
 */
export const fileEntryFor = (path: string): LegacyUrl | undefined =>
  legacyUrls.find((entry) =>
    alternativesOf(entry).some((alternative) => {
      if (alternative.includes("[")) return false;
      const [first = "", ...rest] = alternative.split("*");
      let at = first.length;
      if (!path.startsWith(first)) return false;
      for (const [index, part] of rest.entries()) {
        const found =
          index === rest.length - 1
            ? path.length - part.length
            : path.indexOf(part, at + 1);
        if (found <= at || !path.startsWith(part, found)) return false;
        at = found + part.length;
      }
      return at === path.length;
    }),
  );
