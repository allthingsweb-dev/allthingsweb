/**
 * Runs before `alchemy plan` and `alchemy deploy` (package.json's "plan" and
 * "deploy"). The Web and preview Workers bundle web/src, which imports what
 * web's build writes (web/dist/build.json), and upload web/dist/public as
 * their static assets. Without the build, Alchemy doesn't fail: it waits at
 * "Computing plan" with no end. So this stops at once and says what to run.
 *
 * CI deploys with `bun alchemy deploy` after its own `bun run build` in web/
 * (.github/workflows/deploy.yaml), and `alchemy destroy` reads no assets, so
 * neither goes through this.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** web/dist, from infra/scripts. */
export const WEB_DIST = new URL("../../web/dist/", import.meta.url).pathname;

const isDirectory = (path: string) =>
  existsSync(path) && statSync(path).isDirectory();

/** Why `dist` (web/dist) can't be deployed, or undefined when it can. */
export function webBuildProblem(dist: string): string | undefined {
  const assets = join(dist, "public");
  const ready =
    isDirectory(assets) &&
    readdirSync(assets).length > 0 &&
    existsSync(join(dist, "build.json"));
  return ready
    ? undefined
    : "web/dist/public is missing: run `bun run build` in web/ first (after `bun install` at the repository root)";
}

if (import.meta.main) {
  const problem = webBuildProblem(WEB_DIST);
  if (problem !== undefined) {
    console.error(problem);
    process.exit(1);
  }
}
