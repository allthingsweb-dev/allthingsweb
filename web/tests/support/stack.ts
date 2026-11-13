import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { compatibility } from "../../src/compatibility.ts";

/** The Worker's bindings, as tests give them. */
export interface WorkerEnv {
  readonly ORIGIN: string;
  readonly DATABASE_URL?: string;
  /**
   * Turns on the Worker's page store (src/page-store.ts), in a KV namespace
   * of the Worker's own.
   */
  readonly PAGES?: true;
  /** Lets the writers tell the Worker its data changed (src/refresh.ts). */
  readonly SITE_REFRESH_TOKEN?: string;
  /** Prod's Web Analytics site token: pages carry the beacon (src/web-analytics.ts). */
  readonly WEB_ANALYTICS_TOKEN?: string;
  /** The origin of a `HYPERDRIVE` binding, as the Worker deploys. */
  readonly HYPERDRIVE?: Cloudflare.Hyperdrive.PublicOrigin;
  /** The origin of an `INTAKE` binding, as prod deploys it (src/proposals.ts). */
  readonly INTAKE?: Cloudflare.Hyperdrive.PublicOrigin;
  /** A `PROPOSALS_LIMIT` rate limit of this many a minute (src/proposals.ts). */
  readonly PROPOSALS_LIMIT?: number;
  /**
   * An `IMAGES` binding, as the Worker deploys. Locally, Alchemy's runtime
   * makes variants with Sharp: it reads the size but not the fit, so a
   * square comes out fitted inside the square rather than cropped to it.
   */
  readonly IMAGES?: true;
  /**
   * A `VARIANTS` R2 bucket, as the Worker deploys, named by this: Workers
   * naming the same one share it, as every data center shares a stage's.
   */
  readonly VARIANTS?: string;
  /** Where the Worker fetches the originals of image variants. */
  readonly MEDIA_ORIGIN?: string;
  /** Which Worker: the site (src/worker.ts, the default) or the draft preview (src/preview/worker.ts). */
  readonly entry?: "site" | "preview";
  /** The draft preview's settings (src/preview/access.ts). */
  readonly ACCESS_TEAM_DOMAIN?: string;
  readonly ACCESS_AUD?: string;
  readonly PREVIEW_VIEWERS?: string;
  readonly PUBLIC_URL?: string;
}

/**
 * A Hyperdrive origin for the Postgres at `url`. Alchemy's local runtime
 * hands the Worker the origin itself, with the `sslmode=require` Hyperdrive
 * uses towards it in the connection string, which the servers tests start
 * don't speak: the Worker must not take its TLS setting from there.
 */
export function hyperdriveTo(url: string): Cloudflare.Hyperdrive.PublicOrigin {
  const { hostname, port, username, password, pathname } = new URL(url);
  return {
    scheme: "postgres",
    host: hostname,
    port: Number(port),
    user: decodeURIComponent(username),
    password: Redacted.make(decodeURIComponent(password)),
    database: decodeURIComponent(pathname.slice(1)),
  };
}

/**
 * A stack named `name` of the Worker under each set of bindings in
 * `workers`, bundled the way infra/src/web.ts deploys it and run in workerd
 * by Alchemy's local runtime, static assets included (`bun run test` builds
 * them first). Its state is in memory and every resource is local:
 * deploying it never reaches Cloudflare. Its outputs are the Workers' local
 * URLs.
 */
export const testStack = <const Name extends string>(
  name: string,
  workers: Readonly<Record<Name, WorkerEnv>>,
) =>
  Alchemy.Stack(
    name,
    { providers: Cloudflare.providers(), state: Alchemy.inMemoryState() },
    Effect.gen(function* () {
      const urls = [];
      // Each bucket once, however many Workers share it.
      const buckets = new Map<
        string,
        Effect.Success<ReturnType<typeof Cloudflare.R2.Bucket>>
      >();
      for (const { VARIANTS: bucket } of Object.values<WorkerEnv>(workers)) {
        if (bucket !== undefined && !buckets.has(bucket)) {
          buckets.set(
            bucket,
            yield* Cloudflare.R2.Bucket(bucket, { forceDestroy: true }),
          );
        }
      }
      for (const [worker, env] of Object.entries<WorkerEnv>(workers)) {
        const {
          HYPERDRIVE: origin,
          INTAKE: intake,
          PROPOSALS_LIMIT: proposalsLimit,
          IMAGES: images,
          PAGES: pages,
          VARIANTS: variants,
          entry,
          ...rest
        } = env;
        const settings = {
          ...rest,
          ...(images === undefined
            ? {}
            : { IMAGES: Cloudflare.Images.Images("IMAGES") }),
          ...(intake === undefined
            ? {}
            : {
                INTAKE: yield* Cloudflare.Hyperdrive.Connection(
                  `${worker}Intake`,
                  { origin: intake, caching: { disabled: true } },
                ),
              }),
          ...(proposalsLimit === undefined
            ? {}
            : {
                PROPOSALS_LIMIT: Cloudflare.RateLimit("PROPOSALS_LIMIT", {
                  namespaceId: 1001,
                  simple: { limit: proposalsLimit, period: 60 },
                }),
              }),
          ...((bucket) => (bucket === undefined ? {} : { VARIANTS: bucket }))(
            variants === undefined ? undefined : buckets.get(variants),
          ),
          ...(pages === undefined
            ? {}
            : yield* Effect.map(
                Cloudflare.KV.Namespace(`${worker}Pages`),
                (namespace) => ({
                  PAGES: namespace,
                  PAGES_ID: namespace.namespaceId,
                }),
              )),
        };
        const { url } = yield* Cloudflare.Worker(worker, {
          main: new URL(
            entry === "preview"
              ? "../../src/preview/worker.ts"
              : "../../src/worker.ts",
            import.meta.url,
          ).pathname,
          compatibility,
          assets: new URL("../../dist/public", import.meta.url).pathname,
          env:
            origin === undefined
              ? settings
              : {
                  ...settings,
                  HYPERDRIVE: yield* Cloudflare.Hyperdrive.Connection(
                    `${worker}Hyperdrive`,
                    { origin },
                  ),
                },
        });
        urls.push([worker, url] as const);
      }
      return Object.fromEntries(urls);
    }),
  );

/**
 * What the Worker's modules may weigh gzipped (see support/bundle.ts).
 *
 * - `startup`: the entry and every module it imports statically, which
 *   every cold start parses, even one the store answers. Only the store
 *   (src/page-store.ts) is: about 7.5 KB. It reads the mode cookie itself
 *   (src/pages/theme-cookie.ts) rather than load Effect's cookie module,
 *   which was twice that. The app (src/app.ts) loads on the first request
 *   the store can't answer (src/worker.ts).
 * - `lazy`: each module loaded on first use, with `import()`: the app's
 *   own, the largest about 85 KB, and /brand's and the foundations', a
 *   few KB each.
 *
 * Workers may be 3 MB gzipped, but every byte of the startup modules is
 * parsed on a cold start: raise these only on purpose. When the test
 * fails, it lists what the cold start is made of. `startup` went from
 * 10,000 to 10,100 on 2026-11-05 for the request data points
 * (src/worker.ts, src/metrics.ts): about 45 bytes that hand each answer to
 * the lazily loaded src/metrics.ts after it is sent, which no smaller hook
 * does. It went to 9,200 on 2026-11-13, when a cold start stopped
 * parsing the build manifest for its hash (src/build-id.ts): about 9,060
 * then.
 */
export const bundleBudgets = { startup: 9_200, lazy: 120_000 } as const;
