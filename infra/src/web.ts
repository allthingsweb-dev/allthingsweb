import * as Cloudflare from "alchemy/Cloudflare";
import { compatibility } from "../../web/src/compatibility.ts";
import { readerCaching } from "../../web/src/reader-caching.ts";
import { Reader } from "./reader.ts";
import { requiredSecret } from "./sync.ts";

/**
 * Hyperdrive in front of production's Neon database, as its read-only
 * `reader` role (see reader.ts). Each stage has its own, named after it and
 * destroyed with it. Previews only read, so query results are cached for 60
 * seconds and may be served up to 15 seconds stale while they refresh
 * (web/src/reader-caching.ts, which the page store waits out before it keeps
 * pages of new data). Five origin connections, Hyperdrive's minimum, keep
 * every open stage together well inside Neon's connection limit.
 */
export const Database = Cloudflare.Hyperdrive.Connection("Database", {
  origin: Reader,
  caching: readerCaching,
  originConnectionLimit: 5,
});

/**
 * The page store's namespace: each stage has its own, named after it and
 * destroyed with it. It holds only what the Worker can build again.
 */
export const Pages = Cloudflare.KV.Namespace("Pages");

/** Where the new site lives: canonical URLs, the feeds and link previews name it on every stage. */
export const SITE_HOST = "allthings.dev";
export const SITE_ORIGIN = `https://${SITE_HOST}`;

/**
 * The allthings Worker (web/): the public API, the MCP server, the home
 * page, the evenings index, each event's page, the people and about pages
 * and /brand. Alchemy bundles ../web/src/worker.ts with web's own
 * dependencies and uploads ../web/dist/public as its static assets, so first
 * `bun install` at the repository root and `bun run build` in web/: the
 * Worker imports what the build writes, and the asset layer serves the
 * hashed stylesheet, fonts and marks before the Worker runs.
 *
 * Every stage runs it; prod, in the allthings account only, serves it on
 * allthings.dev once that zone is active there (`domain`, see
 * alchemy.run.ts). It reads data through the `HYPERDRIVE` binding, which
 * every request connects to anew (see web/src/database.ts), so deploying
 * needs `NEON_READER_URL`.
 *
 * `ORIGIN` is allthings.dev on every stage: canonical URLs, the sitemap, the
 * feeds, calendar files, structured data and link previews name it, while
 * pages link within the stage that serves them. It is also the production
 * host: robots.txt lets crawlers in only there, so previews and staging
 * stay out of search results. allthingsweb.dev keeps serving the old app
 * until the full cutover (infra/docs/r2-migration.md).
 *
 * `PAGES` is the Worker's page store (web/src/page-store.ts), a KV namespace
 * of its own on each stage: a page is built from the database once for each
 * version of the data, and served from KV in every data center after.
 * `SITE_REFRESH_TOKEN`, on prod only (`siteRefreshToken`), lets the writers
 * tell the Worker the data changed (web/src/refresh.ts): the Sync Worker
 * after each run that writes, through its service binding, and anything
 * else that writes with the token. Other stages are told nothing and check
 * on their own.
 *
 * `IMAGES` makes the photos' variants (web/src/images/route.ts) from the
 * originals on the media origin; it has no resource of its own, and
 * transformations are billed to the account.
 */
export const makeWeb = (
  domain?: Cloudflare.WorkerDomainConfig,
  refreshToken?: ReturnType<typeof requiredSecret>,
) =>
  Cloudflare.Worker("Web", {
    main: "../web/src/worker.ts",
    compatibility,
    assets: "../web/dist/public",
    env: {
      ORIGIN: SITE_ORIGIN,
      PAGES: Pages,
      HYPERDRIVE: Database,
      IMAGES: Cloudflare.Images.Images("IMAGES"),
      ...(refreshToken === undefined
        ? {}
        : { SITE_REFRESH_TOKEN: refreshToken }),
    },
    ...(domain === undefined ? {} : { domain }),
  });

/**
 * The token the writers tell prod's site with, from `SITE_REFRESH_TOKEN`
 * (the 1Password item "allthings site refresh", made by
 * scripts/site-refresh-token.ts). A Config, so only a prod deploy needs it.
 */
export const siteRefreshToken = requiredSecret("SITE_REFRESH_TOKEN");

/** The site on its own (every stage but prod): no custom domain, on workers.dev. */
export const Web = makeWeb();

/**
 * Prod's custom domain: allthings.dev, with www.allthings.dev answering a
 * 301 to it (path and query kept) before the Worker runs. The zone must be
 * active in the deploying account.
 */
export const siteDomain = (zoneId: string): Cloudflare.WorkerDomainConfig => ({
  name: SITE_HOST,
  redirects: [`www.${SITE_HOST}`],
  zoneId,
});
