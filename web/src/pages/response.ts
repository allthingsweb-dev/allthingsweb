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
 * Each coding in an Accept-Encoding header with its weight (RFC 9110,
 * 12.5.3): `q` is read as a number, case-insensitively, and a coding
 * without a readable one weighs 1.
 */
function weights(acceptEncoding: string): Map<string, number> {
  const weights = new Map<string, number>();
  for (const part of acceptEncoding.split(",")) {
    const [coding = "", ...parameters] = part
      .split(";")
      .map((piece) => piece.trim());
    if (coding === "") continue;
    const q = parameters
      .map((parameter) => /^q\s*=\s*([0-9.]+)$/i.exec(parameter)?.[1])
      .find((value) => value !== undefined);
    const weight = q === undefined ? Number.NaN : Number(q);
    weights.set(coding.toLowerCase(), Number.isNaN(weight) ? 1 : weight);
  }
  return weights;
}

/**
 * The encoding to send to a client that accepts `acceptEncoding`: Brotli,
 * else gzip, else none. A coding the client weighs 0 is refused, and `*`
 * stands for any coding it doesn't name. Setting Content-Encoding is how a
 * Worker asks the runtime to compress a body; a client that sends no
 * Accept-Encoding gets the HTML as is.
 */
export function contentEncoding(
  acceptEncoding: string | undefined,
): "br" | "gzip" | undefined {
  const accepted = weights(acceptEncoding ?? "");
  const wildcard = accepted.get("*") ?? 0;
  const acceptable = (coding: string) => (accepted.get(coding) ?? wildcard) > 0;
  if (acceptable("br")) return "br";
  if (acceptable("gzip")) return "gzip";
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
