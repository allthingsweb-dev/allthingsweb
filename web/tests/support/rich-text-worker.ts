import { sanitizeRichText } from "allthings-core/src/rich-text.ts";
import { Effect } from "effect";

/**
 * A Worker that sanitizes a JSON string, so tests can run the Worker's
 * sanitizer in workerd. JSON keeps every character of the input intact.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const html: unknown = await request.json();
    if (typeof html !== "string") {
      return new Response("Send a JSON string.", { status: 400 });
    }
    return Response.json(await Effect.runPromise(sanitizeRichText(html)));
  },
};
