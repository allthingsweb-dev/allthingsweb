import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { compatibility } from "../../src/compatibility.ts";

/** The Worker's bindings, as tests give them. */
export interface WorkerEnv {
  readonly ORIGIN: string;
  readonly DATABASE_URL?: string;
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
        const { url } = yield* Cloudflare.Worker(worker, {
          main: new URL("../../src/worker.ts", import.meta.url).pathname,
          compatibility,
          assets: new URL("../../dist/public", import.meta.url).pathname,
          env: { ...env },
        });
        urls.push([worker, url] as const);
      }
      return Object.fromEntries(urls);
    }),
  );

/**
 * The most the Worker's bundle may weigh gzipped. Today it is about 820 KB,
 * 229 KB gzipped: Effect is a third of it, the MCP SDK and the zod it brings
 * another third, and @effect/sql-pg most of the rest; the pages (templates,
 * tokens and the foundations as HTML) are 14 KB. The 21 KB left is room for
 * the site's remaining pages. Workers may be 3 MB gzipped, but every byte is
 * parsed on a cold start: raise this only on purpose.
 */
export const bundleBudget = 250_000;
