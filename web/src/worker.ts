import { makeHandler } from "./app.ts";

let handle: ((request: Request) => Promise<Response>) | undefined;

/**
 * The all things Worker. Bindings are fixed for an isolate's lifetime, so the
 * router and its settings are built on the first request and reused.
 */
export default {
  fetch(
    request: Request,
    env: Readonly<Record<string, unknown>>,
  ): Promise<Response> {
    handle ??= makeHandler(env);
    return handle(request);
  },
};
