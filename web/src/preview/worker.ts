import { type ExecutionContext, makePreviewHandler } from "./app.ts";

let handle:
  | ((request: Request, context: ExecutionContext) => Promise<Response>)
  | undefined;

/**
 * The draft preview Worker (app.ts), behind Cloudflare Access
 * (infra/src/preview.ts). Bindings are fixed for an isolate's lifetime, so
 * its handler is built on the first request and reused. It has no edge
 * cache: a draft is never stored anywhere.
 */
export default {
  fetch(
    request: Request,
    env: Readonly<Record<string, unknown>>,
    context: ExecutionContext,
  ): Promise<Response> {
    handle ??= makePreviewHandler(env);
    return handle(request, context);
  },
};
