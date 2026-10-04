import * as Cloudflare from "alchemy/Cloudflare";
import { compatibility } from "../../web/src/compatibility.ts";

/**
 * The all things Worker (web/): the public API, the MCP server, the home
 * page and /brand today, the whole site after the cutover. Alchemy bundles
 * ../web/src/worker.ts with web's own dependencies and uploads
 * ../web/dist/public as its static assets, so first `bun install` at the
 * repository root and `bun run build` in web/: the Worker imports what the
 * build writes, and the asset layer serves the hashed stylesheet, fonts and
 * marks before the Worker runs.
 *
 * Not deployed to prod yet; see alchemy.run.ts. Its data bindings are still
 * to come, with Hyperdrive in front of Neon: until then the Worker answers
 * data requests the way the app does when its database is down (a 500 on
 * the v1 API, "temporarily unavailable" from the MCP tools, a 503 page for
 * home, and blank avatars in place of the hosts' portraits, uncached), while
 * initialize, tools/list and get_community work. `ORIGIN` stays the current
 * site, where the event pages and the code of conduct are.
 */
export const Web = Cloudflare.Worker("Web", {
  main: "../web/src/worker.ts",
  compatibility,
  assets: "../web/dist/public",
  env: {
    ORIGIN: "https://allthingsweb.dev",
  },
});
