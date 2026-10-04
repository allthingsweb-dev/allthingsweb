import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { CacheControl } from "../cache.ts";
import { mediaOrigin } from "../links.ts";

/**
 * How pages are sent. They run no scripts and load nothing from other
 * origins but event photos from the media origin, and the
 * Content-Security-Policy makes browsers hold them to it.
 */
export const contentSecurityPolicy = [
  "default-src 'none'",
  "style-src 'self'",
  "font-src 'self'",
  `img-src 'self' ${mediaOrigin}`,
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
  const byCoding = new Map<string, number>();
  for (const part of acceptEncoding.split(",")) {
    const [coding = "", ...parameters] = part
      .split(";")
      .map((piece) => piece.trim());
    if (coding === "") continue;
    const q = parameters
      .map((parameter) => /^q\s*=\s*([0-9.]+)$/i.exec(parameter)?.[1])
      .find((value) => value !== undefined);
    const weight = q === undefined ? Number.NaN : Number(q);
    byCoding.set(coding.toLowerCase(), Number.isNaN(weight) ? 1 : weight);
  }
  return byCoding;
}

/**
 * The coding to send to a client that accepts `acceptEncoding`: Brotli,
 * else gzip, else `identity` (the HTML as is), or `undefined` when the
 * client refuses all three. A coding the client weighs 0 is refused, and
 * `*` stands for any coding it doesn't name. Identity is acceptable unless
 * refused that way (RFC 9110, 12.5.3), so a client that sends no
 * Accept-Encoding gets the HTML as is. Setting Content-Encoding is how a
 * Worker asks the runtime to compress a body.
 */
export function contentEncoding(
  acceptEncoding: string | undefined,
): "br" | "gzip" | "identity" | undefined {
  const accepted = weights(acceptEncoding ?? "");
  const wildcard = accepted.get("*");
  const weight = (coding: string) => accepted.get(coding) ?? wildcard;
  if ((weight("br") ?? 0) > 0) return "br";
  if ((weight("gzip") ?? 0) > 0) return "gzip";
  if ((weight("identity") ?? 1) > 0) return "identity";
  return undefined;
}

const headers = {
  "content-security-policy": contentSecurityPolicy,
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  vary: "accept-encoding",
} as const;

export interface HtmlOptions {
  /** How long the page may be kept: a pure function of data or of the build. */
  readonly cacheControl: CacheControl;
  /** 200 unless said otherwise. */
  readonly status?: number;
}

/**
 * A page's HTML, compressed when the client accepts it. A client that
 * refuses every coding we have, identity included, gets 406 Not Acceptable.
 */
export function htmlResponse(
  html: string,
  acceptEncoding: string | undefined,
  { cacheControl, status = 200 }: HtmlOptions,
): HttpServerResponse.HttpServerResponse {
  const encoding = contentEncoding(acceptEncoding);
  if (encoding === undefined) {
    return HttpServerResponse.text("Not Acceptable: br, gzip or identity", {
      status: 406,
      headers: { "cache-control": CacheControl.failure, vary: headers.vary },
    });
  }
  return HttpServerResponse.text(html, {
    status,
    contentType: "text/html; charset=utf-8",
    headers: {
      ...headers,
      "cache-control": cacheControl,
      ...(encoding === "identity" ? {} : { "content-encoding": encoding }),
    },
  });
}
