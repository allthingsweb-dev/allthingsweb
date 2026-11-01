import * as HttpServerResponse from "effect/http/HttpServerResponse";
import {
  CacheControl,
  type CacheControlName,
  edgeCacheControlHeader,
  PrivateCacheControl,
} from "../cache.ts";
import { mediaOrigin } from "../links.ts";
import { contentEncoding } from "./encoding.ts";
import type { ImageMode } from "./picture.tsx";
import type { Theme } from "./theme.ts";

const policy = (imgSrc: string, scripts = false) =>
  [
    "default-src 'none'",
    ...(scripts ? ["script-src 'self'"] : []),
    "style-src 'self'",
    "font-src 'self'",
    `img-src ${imgSrc}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");

/**
 * How pages are sent. They run no scripts and load nothing from other
 * origins, and the Content-Security-Policy makes browsers hold them to it.
 * The one exception, a lab page with an engine, may run this site's own
 * modules (scriptedContentSecurityPolicy) and nothing else.
 * Photos come from this site as variants; only a Worker that can't make
 * them (see picture.tsx) links the originals on the media origin, and only
 * its pages may load images from there.
 */
export const contentSecurityPolicy: Readonly<Record<ImageMode, string>> = {
  variants: policy("'self'"),
  originals: policy(`'self' ${mediaOrigin}`),
};

/**
 * The policy of a page that runs a script: the lab's pages with an engine
 * (pages/lab/, src/client/lab.ts) load this site's own modules, and
 * nothing else; no inline script, no other origin.
 */
export const scriptedContentSecurityPolicy: Readonly<
  Record<ImageMode, string>
> = {
  variants: policy("'self'", true),
  originals: policy(`'self' ${mediaOrigin}`, true),
};

const headers = {
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  // Every page renders the mode its visitor's `theme` cookie fixes.
  vary: "accept-encoding, cookie",
} as const;

export interface HtmlOptions {
  /**
   * How long the page may be kept: a pure function of data or of the build.
   * Only the visitor's browser may keep a page in a mode they fixed.
   */
  readonly cacheControl: CacheControlName;
  /** The mode the page was rendered in, from the visitor's cookie. */
  readonly theme: Theme | undefined;
  /** How the page shows photos, which its policy allows. */
  readonly images: ImageMode;
  /** 200 unless said otherwise. */
  readonly status?: number;
  /** It loads this site's scripts (see scriptedContentSecurityPolicy). */
  readonly scripts?: boolean;
  /**
   * How long reading its data took, in milliseconds, for Server-Timing.
   * Rendering is CPU alone, which workerd's clock doesn't count (it moves
   * only on I/O, against timing attacks), so it isn't reported.
   */
  readonly db?: number;
}

/**
 * A page's HTML, compressed when the client accepts it. A client that
 * refuses every coding we have, identity included, gets 406 Not Acceptable.
 */
export function htmlResponse(
  html: string,
  acceptEncoding: string | undefined,
  {
    cacheControl,
    theme,
    images,
    status = 200,
    db,
    scripts = false,
  }: HtmlOptions,
): HttpServerResponse.HttpServerResponse {
  const encoding = contentEncoding(acceptEncoding);
  if (encoding === undefined) {
    return HttpServerResponse.text("Not Acceptable: br, gzip or identity", {
      status: 406,
      headers: {
        "cache-control": CacheControl.failure,
        vary: "accept-encoding",
      },
    });
  }
  return HttpServerResponse.text(html, {
    status,
    contentType: "text/html; charset=utf-8",
    headers: {
      ...headers,
      "content-security-policy": (scripts
        ? scriptedContentSecurityPolicy
        : contentSecurityPolicy)[images],
      "cache-control":
        theme === undefined
          ? CacheControl[cacheControl]
          : PrivateCacheControl[cacheControl],
      // The Worker's cache keeps a page in a fixed mode under that mode.
      ...(theme === undefined || cacheControl === "failure"
        ? {}
        : { [edgeCacheControlHeader]: CacheControl[cacheControl] }),
      ...(db === undefined
        ? {}
        : { "server-timing": `db;dur=${db.toFixed(1)}` }),
      ...(encoding === "identity" ? {} : { "content-encoding": encoding }),
    },
  });
}
