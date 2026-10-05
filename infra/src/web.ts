import * as Cloudflare from "alchemy/Cloudflare";
import { compatibility } from "../../web/src/compatibility.ts";
import { Reader } from "./reader.ts";

/**
 * Hyperdrive in front of production's Neon database, as its read-only
 * `reader` role (see reader.ts). Each stage has its own, named after it and
 * destroyed with it. Previews only read, so query results are cached for 60
 * seconds and may be served up to 15 seconds stale while they refresh. Five
 * origin connections, Hyperdrive's minimum, keep every open stage together
 * well inside Neon's connection limit.
 */
export const Database = Cloudflare.Hyperdrive.Connection("Database", {
  origin: Reader,
  caching: { maxAge: 60, staleWhileRevalidate: 15 },
  originConnectionLimit: 5,
});

/**
 * The all things Worker (web/): the public API, the MCP server, the home
 * page, the evenings index, each event's page, the people and about pages
 * and /brand today, the whole site after the cutover. Alchemy bundles ../web/src/worker.ts with
 * web's own dependencies and uploads ../web/dist/public as its static
 * assets, so first `bun install` at the repository root and `bun run build`
 * in web/: the Worker imports what the build writes, and the asset layer
 * serves the hashed stylesheet, fonts and marks before the Worker runs.
 *
 * Not deployed to prod yet; see alchemy.run.ts. It reads data through the
 * `HYPERDRIVE` binding, which every request connects to anew (see
 * web/src/database.ts), so deploying needs `NEON_READER_URL`. `ORIGIN` stays
 * the current site, which canonical URLs and the feeds name; pages link
 * within the stage that serves them. It is also the production host: robots.txt lets crawlers in only there, so
 * every stage stays out of search results until the cutover sets `ORIGIN`
 * to the domain this Worker serves.
 */
export const Web = Cloudflare.Worker("Web", {
  main: "../web/src/worker.ts",
  compatibility,
  assets: "../web/dist/public",
  env: {
    ORIGIN: "https://allthingsweb.dev",
    HYPERDRIVE: Database,
  },
});
