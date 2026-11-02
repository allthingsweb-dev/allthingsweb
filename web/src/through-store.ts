import { Context, Option } from "effect";

/**
 * The page store in front of the app (worker.ts), when the Worker has one:
 * for what the app reads through it rather than from the database, as a GET
 * of a kept address, such as `/mcp`'s tools (mcp/endpoint.ts) and the
 * hosts' portraits on pages that read nothing else (pages/routes.ts).
 * Without a store (tests, previews) there is none, and they read the
 * database.
 */
export class ThroughStore extends Context.Reference<
  Option.Option<
    (
      request: Request,
      context: { waitUntil(promise: Promise<unknown>): void },
    ) => Promise<Response>
  >
>("allthings/web/ThroughStore", { defaultValue: () => Option.none() }) {}
