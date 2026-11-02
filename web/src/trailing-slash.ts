import { CacheControl } from "./cache.ts";

/**
 * A path with a trailing slash is the page without it, "/" aside: a
 * permanent redirect (308, so a POST is sent on as a POST) with the query
 * kept. The Worker answers it first (worker.ts), before the page store or
 * the app see the request, so it keeps nothing and reads nothing. The path
 * is kept as it was sent, its leading slashes as one, so the address never
 * reads as another host's ("//x/").
 */
export function withoutTrailingSlash(url: string): Response | undefined {
  const { pathname, search } = new URL(url);
  if (pathname === "/" || !pathname.endsWith("/")) return undefined;
  const path = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  return new Response(null, {
    status: 308,
    headers: {
      location: `/${path}${search}`,
      "cache-control": CacheControl.page,
    },
  });
}
