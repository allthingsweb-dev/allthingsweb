import * as Cloudflare from "alchemy/Cloudflare";
import { compatibility } from "../../web/src/compatibility.ts";

/**
 * The all things Worker (web/): the public API and the MCP server today, the
 * whole site after the cutover. Alchemy bundles ../web/src/worker.ts with
 * web's own dependencies, so `bun install` at the repository root first.
 *
 * Not deployed to prod yet; see alchemy.run.ts. Its data bindings are still
 * to come, with Hyperdrive in front of Neon: until then the Worker answers
 * data requests the way the app does when its database is down (a 500 on
 * the v1 API, "temporarily unavailable" from the MCP tools), while
 * initialize, tools/list and get_community work. `ORIGIN` stays the current
 * site, where the event pages and the code of conduct are.
 */
export const Web = Cloudflare.Worker("Web", {
  main: "../web/src/worker.ts",
  compatibility,
  env: {
    ORIGIN: "https://allthingsweb.dev",
  },
});
