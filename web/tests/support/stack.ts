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
   * Turns on the Worker's own cache under this name (see worker.ts); each
   * test Worker that sets it needs its own.
   */
  readonly EDGE_CACHE?: string;
  /** The origin of a `HYPERDRIVE` binding, as the Worker deploys. */
  readonly HYPERDRIVE?: Cloudflare.Hyperdrive.PublicOrigin;
  /**
   * An `IMAGES` binding, as the Worker deploys. Locally, Alchemy's runtime
   * makes variants with Sharp: it reads the size but not the fit, so a
   * square comes out fitted inside the square rather than cropped to it.
   */
  readonly IMAGES?: true;
  /** Where the Worker fetches the originals of image variants. */
  readonly MEDIA_ORIGIN?: string;
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
      for (const [worker, env] of Object.entries<WorkerEnv>(workers)) {
        const { HYPERDRIVE: origin, IMAGES: images, ...rest } = env;
        const settings =
          images === undefined
            ? rest
            : { ...rest, IMAGES: Cloudflare.Images.Images("IMAGES") };
        const { url } = yield* Cloudflare.Worker(worker, {
          main: new URL("../../src/worker.ts", import.meta.url).pathname,
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
 *   every cold start parses. Today about 160 KB: Effect is most of it,
 *   then @effect/sql-pg; the pages are about 25 KB.
 * - `lazy`: each module loaded on first use, with `import()`. The MCP
 *   server (its SDK and zod) is about 86 KB and serves only `/mcp`;
 *   /brand and the foundations are a few KB.
 *
 * Workers may be 3 MB gzipped, but every byte of the startup modules is
 * parsed on a cold start: raise these only on purpose. When the test
 * fails, it lists what the cold start is made of.
 */
export const bundleBudgets = { startup: 250_000, lazy: 120_000 } as const;
