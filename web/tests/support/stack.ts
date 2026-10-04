import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { compatibility } from "../../src/compatibility.ts";

/** The Worker's bindings, as tests give them. */
export interface WorkerEnv {
  readonly ORIGIN: string;
  readonly DATABASE_URL?: string;
  readonly LEGACY_MEDIA_ORIGIN?: string;
}

/**
 * A stack of the Worker under each set of bindings in `workers`, bundled the
 * way infra/src/web.ts deploys it and run in workerd by Alchemy's local
 * runtime. Its state is in memory and every resource is local: deploying it
 * never reaches Cloudflare. Its outputs are the Workers' local URLs.
 */
export const testStack = <const Name extends string>(
  workers: Readonly<Record<Name, WorkerEnv>>,
) =>
  Alchemy.Stack(
    "allthings-web-test",
    { providers: Cloudflare.providers(), state: Alchemy.inMemoryState() },
    Effect.gen(function* () {
      const urls = [];
      for (const [name, env] of Object.entries<WorkerEnv>(workers)) {
        const worker = yield* Cloudflare.Worker(name, {
          main: new URL("../../src/worker.ts", import.meta.url).pathname,
          compatibility,
          env: { ...env },
        });
        urls.push([name, worker.url] as const);
      }
      return Object.fromEntries(urls);
    }),
  );
