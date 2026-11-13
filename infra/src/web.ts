import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import { variantsCheckPath } from "../../core/src/refresh-path.ts";
import { compatibility } from "../../web/src/compatibility.ts";
import { readerCaching } from "../../web/src/reader-caching.ts";
import {
  REQUESTS_DATASET,
  type RequestsDataset,
} from "../../web/src/metrics.ts";
import { Intaker, Reader } from "./reader.ts";
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
 * Hyperdrive in front of production's Neon database as `proposal_intake`
 * (reader.ts's {@link Intaker}), for talk proposals from anyone
 * (web/src/proposals.ts): a role that may only add a proposal. Prod alone
 * has it, since every other stage reads production and must not write to
 * it. It never caches; five origin connections is Hyperdrive's minimum.
 */
export const IntakeDatabase = Cloudflare.Hyperdrive.Connection("Intake", {
  origin: Intaker,
  caching: { disabled: true },
  originConnectionLimit: 5,
});

/**
 * The site's rate limit on proposals (web/src/proposals.ts), by address:
 * `perMinute` a minute, counted in each Cloudflare location. The table
 * stops a day's flood on its own (core/migrations/0040_proposals.ts).
 * `namespaceId` names the limit's counters in the account.
 */
export const proposalsLimit = { namespaceId: 1001, perMinute: 5 } as const;

/**
 * The page store's namespace: each stage has its own, named after it and
 * destroyed with it. It holds only what the Worker can build again.
 */
export const Pages = Cloudflare.KV.Namespace("Pages");

/**
 * The photos' variants once made (web/src/images/route.ts): each stage has
 * its own bucket, named after it and destroyed with it, emptied first. A
 * variant is made once and kept here under its path, which names the
 * photo's version, so every data center serves it from here rather than
 * making it again. It holds only what the Worker can make again.
 */
export const Variants = Cloudflare.R2.Bucket("Variants", {
  forceDestroy: true,
});

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
 * stay out of search results. allthingsweb.dev redirects here, path and
 * query kept: a redirect rule on its own Cloudflare zone, which esthor/domains
 * manages.
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
 * transformations are billed to the account. `VARIANTS` keeps each one
 * made ({@link Variants}), so it is made once, not once per data center.
 */
export const makeWeb = (
  domain?: Cloudflare.WorkerDomainConfig,
  refreshToken?: ReturnType<typeof requiredSecret>,
  requests: RequestsDataset = REQUESTS_DATASET.preview,
  analyticsToken?: Output.Output<string>,
  /** Whether this stage takes talk proposals: prod alone ({@link IntakeDatabase}). */
  intake = false,
) =>
  Effect.flatMap(Effect.all([Pages, Variants]), ([pages, variants]) =>
    Cloudflare.Worker("Web", {
      main: "../web/src/worker.ts",
      compatibility,
      assets: "../web/dist/public",
      // Workers Cache: Cloudflare answers a GET from its cache before the
      // Worker starts, for as long as the response says (web/src/cache.ts,
      // `forWorkersCache`). A deploy starts it cold: it is keyed by the
      // Worker's version.
      cache: { enabled: true },
      env: {
        ORIGIN: SITE_ORIGIN,
        PAGES: pages,
        // Names the namespace's copies in each data center's cache, so no
        // other Worker there shares them.
        PAGES_ID: pages.namespaceId,
        HYPERDRIVE: Database,
        IMAGES: Cloudflare.Images.Images("IMAGES"),
        VARIANTS: variants,
        // One anonymous data point per request (web/src/metrics.ts).
        REQUESTS: Cloudflare.AnalyticsEngine.Dataset("Requests", {
          dataset: requests,
        }),
        ...(refreshToken === undefined
          ? {}
          : { SITE_REFRESH_TOKEN: refreshToken }),
        // Prod's Web Analytics site token: its pages carry the beacon
        // (web/src/web-analytics.ts). No other stage is measured.
        ...(analyticsToken === undefined
          ? {}
          : { WEB_ANALYTICS_TOKEN: analyticsToken }),
        // How many proposals one address may send a minute
        // (web/src/proposals.ts). Every stage counts; only prod keeps them.
        PROPOSALS_LIMIT: Cloudflare.RateLimit("PROPOSALS_LIMIT", {
          namespaceId: proposalsLimit.namespaceId,
          simple: { limit: proposalsLimit.perMinute, period: 60 },
        }),
        // Prod keeps proposals, as proposal_intake (web/src/proposals.ts).
        ...(intake ? { INTAKE: IntakeDatabase } : {}),
      },
      ...(domain === undefined ? {} : { domain }),
    }),
  );

/**
 * The token the writers tell prod's site with, from `SITE_REFRESH_TOKEN`
 * (the 1Password item "allthings site refresh", made by
 * scripts/site-refresh-token.ts). A Config, so only a prod deploy needs it.
 */
export const siteRefreshToken = requiredSecret("SITE_REFRESH_TOKEN");

/**
 * Cloudflare Web Analytics for allthings.dev (prod, once the zone is
 * active in the account): page views, referrers and Core Web Vitals,
 * cookieless. The site existed before it was declared here, so it is
 * adopted. Cloudflare doesn't inject its beacon (`autoInstall: false`):
 * it can't reach the site's compressed pages, and their policy would
 * refuse it. The Web Worker adds it instead, with this site's token
 * (web/src/web-analytics.ts).
 */
export const webAnalytics = (zoneId: string) =>
  Cloudflare.Rum.Site("WebAnalytics", {
    zoneTag: zoneId,
    autoInstall: false,
  }).pipe(Alchemy.AdoptPolicy.adopt(true));

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

/**
 * Prod's deploy-time proof that the site's variants bucket takes writes,
 * as MediaUploadCheck proves uploads: the Worker, asked with the writers'
 * token, stores one object of its own under `deploy-checks/`, reads it
 * back, deletes it and finds it gone (web/src/images/kept.ts,
 * `checkVariantStore`). Any step that fails fails the deploy. `run` is new
 * on every deploy, so Alchemy runs it every time, not only when the Worker
 * changes.
 */
export const VariantsCheck = Alchemy.Action(
  "VariantsCheck",
  (input: {
    url: string;
    token: Redacted.Redacted;
    workerHash: string;
    run: string;
  }) =>
    Effect.tryPromise(() =>
      fetch(`${input.url}${variantsCheckPath}`, {
        method: "POST",
        headers: { authorization: `Bearer ${Redacted.value(input.token)}` },
      }),
    ).pipe(
      Effect.flatMap((response) =>
        Effect.tryPromise(() => response.text()).pipe(
          Effect.filterOrFail(
            () => response.status === 200,
            (body) =>
              new Error(
                `the variants check answered ${response.status}: ${body.slice(0, 200)}`,
              ),
          ),
        ),
      ),
      // A new deployment takes a few seconds to answer everywhere.
      Effect.retry({ schedule: Schedule.spaced("2 seconds"), times: 15 }),
      Effect.as({ checked: input.workerHash }),
      Effect.orDie,
    ),
);
