import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { CacheControl } from "../cache.ts";

/**
 * How pages are sent. They load nothing from other origins and run no
 * scripts, and the Content-Security-Policy makes browsers hold them to it.
 */
export const contentSecurityPolicy = [
  "default-src 'none'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * The encoding to send to a client that accepts `acceptEncoding`: Brotli,
 * else gzip, else none. Setting Content-Encoding is how a Worker asks the
 * runtime to compress a body; a client that sends no Accept-Encoding gets
 * the HTML as is.
 */
export function contentEncoding(
  acceptEncoding: string | undefined,
): "br" | "gzip" | undefined {
  const accepted = new Set(
    (acceptEncoding ?? "")
      .split(",")
      .map((part) => part.trim().split(";"))
      .filter(([, quality]) => quality?.trim() !== "q=0")
      .map(([coding]) => coding?.trim().toLowerCase()),
  );
  if (accepted.has("br")) return "br";
  if (accepted.has("gzip")) return "gzip";
  return undefined;
}

/** A page's HTML, compressed when the client accepts it. */
export function htmlResponse(
  html: string,
  acceptEncoding: string | undefined,
): HttpServerResponse.HttpServerResponse {
  const encoding = contentEncoding(acceptEncoding);
  return HttpServerResponse.text(html, {
    contentType: "text/html; charset=utf-8",
    headers: {
      "cache-control": CacheControl.page,
      "content-security-policy": contentSecurityPolicy,
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
      vary: "accept-encoding",
      ...(encoding === undefined ? {} : { "content-encoding": encoding }),
    },
  });
}
