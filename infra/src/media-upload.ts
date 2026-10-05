import type { MediaUploadEnv } from "./upload-worker.ts";

// Matches the app's object keys: path segments of letters, marks, digits and
// `._-`, never starting with a dot.
const KEY =
  /^[\p{L}\p{N}_][\p{L}\p{M}\p{N}._-]*(\/[\p{L}\p{N}_][\p{L}\p{M}\p{N}._-]*)*$/u;

const encoder = new TextEncoder();

// Compares in time that depends only on the length, so a caller can't recover
// the token one byte at a time.
function authorized(request: Request, token: string): boolean {
  const presented = encoder.encode(request.headers.get("authorization") ?? "");
  const expected = encoder.encode(`Bearer ${token}`);
  if (presented.byteLength !== expected.byteLength) return false;
  let difference = 0;
  for (let i = 0; i < expected.byteLength; i++) {
    difference |= (presented[i] ?? 0) ^ (expected[i] ?? 0);
  }
  return difference === 0;
}

/** The object key from the path, or undefined if it's malformed or not a valid key. */
function objectKey(request: Request): string | undefined {
  try {
    const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
    // Like the app, never accept ".." inside a segment.
    return KEY.test(key) && !key.split("/").some((s) => s.includes(".."))
      ? key
      : undefined;
  } catch {
    // Malformed percent-encoding.
    return undefined;
  }
}

export default {
  async fetch(request: Request, env: MediaUploadEnv): Promise<Response> {
    if (!authorized(request, env.UPLOAD_TOKEN)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const key = objectKey(request);
    if (key === undefined) {
      return new Response("Invalid key", { status: 400 });
    }
    switch (request.method) {
      case "PUT": {
        const contentType = request.headers.get("content-type");
        // An object never changes under its key: the site caches variants
        // of it for a year under URLs derived from the key (web/src/images).
        // A replacement goes under a new key, with its `images` row updated.
        const object = await env.MEDIA.put(key, request.body, {
          onlyIf: new Headers({ "if-none-match": "*" }),
          ...(contentType ? { httpMetadata: { contentType } } : {}),
        });
        if (object === null) {
          return new Response("An object already exists at this key", {
            status: 409,
          });
        }
        return Response.json(
          { key: object.key, size: object.size },
          { status: 201 },
        );
      }
      case "DELETE":
        await env.MEDIA.delete(key);
        return new Response(null, { status: 204 });
      default:
        return new Response("Method not allowed", {
          status: 405,
          headers: { allow: "PUT, DELETE" },
        });
    }
  },
};
