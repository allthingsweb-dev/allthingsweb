import { mock } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";

/**
 * The app's own public surfaces, run in this process over the same database
 * the Worker reads: its v1 route handlers and its MCP tools, wired as
 * app/src/app/mcp/route.ts wires them (through mcp-handler, its drizzle
 * queries and its mappers). The Worker is held to their answers.
 *
 * The app's modules are loaded at runtime rather than imported: the app's own
 * compiler checks them, and web's stricter settings would reject code that is
 * not being changed here. The narrow types below are all the tests rely on.
 */

const app = new URL("../../../app/", import.meta.url);
const load = (path: string): Promise<unknown> =>
  import(new URL(path, app).href);
const appPackage = (name: string): Promise<unknown> =>
  import(Bun.resolveSync(name, app.pathname));

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

export interface App {
  /** Answers a GET to one of the v1 API's paths, as the app's routes do. */
  readonly v1: (path: string) => Promise<Response>;
  /** The app's MCP endpoint. */
  readonly mcp: (request: Request) => Promise<Response>;
}

export async function loadApp(
  db: PGlite,
  settings: { readonly origin: string },
): Promise<App> {
  const { drizzle } = (await appPackage("drizzle-orm/pglite")) as {
    drizzle: (config: { client: PGlite }) => unknown;
  };
  const appDb = drizzle({ client: db });
  // The app reads its database and config from modules; point them here.
  await mock.module(new URL("src/lib/db.ts", app).pathname, () => ({
    db: appDb,
  }));
  await mock.module(new URL("src/lib/config.ts", app).pathname, () => ({
    mainConfig: {
      instance: { origin: settings.origin },
    },
  }));

  const route = async (path: string) =>
    ((await load(path)) as { GET: RouteHandler }).GET;
  const events = await route("src/app/api/v1/events/route.ts");
  const eventById = await route("src/app/api/v1/events/[id]/route.ts");
  const speakers = await route("src/app/api/v1/speakers/route.ts");

  const { createMcpHandler } = (await appPackage("mcp-handler")) as {
    createMcpHandler: (
      init: (server: unknown) => void,
      options: { serverInfo: { name: string; version: string } },
    ) => (request: Request) => Promise<Response>;
  };
  const { registerAtwTools } = (await load("src/lib/mcp/tools.ts")) as {
    registerAtwTools: (server: unknown, deps: unknown) => void;
  };
  const { getPublishedEvents } = (await load(
    "src/lib/published-events.ts",
  )) as { getPublishedEvents: () => Promise<unknown> };
  const { getExpandedEventBySlug } = (await load(
    "src/lib/expanded-events.ts",
  )) as { getExpandedEventBySlug: (slug: string) => Promise<unknown> };
  const { getSpeakerDirectory } = (await load(
    "src/lib/speaker-directory.ts",
  )) as { getSpeakerDirectory: (database: unknown) => Promise<unknown> };
  const { version } = (await load("package.json")) as { version: string };

  const mcp = createMcpHandler(
    (server) =>
      registerAtwTools(server, {
        origin: settings.origin,
        now: () => new Date(),
        listPublishedEvents: getPublishedEvents,
        getEventBySlug: getExpandedEventBySlug,
        getSpeakerDirectory: () => getSpeakerDirectory(appDb),
        reportError: (error: unknown) => {
          throw error;
        },
      }),
    { serverInfo: { name: "allthings", version } },
  );

  const eventPath = /^\/api\/v1\/events\/([^/]+)$/;
  return {
    v1: (path) => {
      const request = new Request(new URL(path, settings.origin).href);
      if (path === "/api/v1/events") return events(request, params({}));
      if (path === "/api/v1/speakers") return speakers(request, params({}));
      const id = eventPath.exec(path)?.[1];
      if (id === undefined) throw new Error(`The app has no route ${path}.`);
      return eventById(request, params({ id: decodeURIComponent(id) }));
    },
    mcp,
  };
}

const params = (values: Record<string, string>) => ({
  params: Promise.resolve(values),
});
