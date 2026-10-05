/**
 * robots.txt. The Worker answers on many hosts: a pr-<number> stage per
 * pull request, staging, and production. Only production may be crawled;
 * every other host shows the same pages under a name nobody should find in
 * a search, so crawlers are asked to stay out of all of it.
 *
 * Production is the host of the configured origin (`ORIGIN`, see site.ts),
 * the one every canonical URL, feed and sitemap names. Ports and schemes
 * are not compared: Cloudflare serves a hostname on its standard ports,
 * and a crawler that asks over http is still asking production.
 */

/** Whether a request to `requestUrl` reached the production host of `origin`. */
export function isProductionHost(requestUrl: string, origin: string): boolean {
  const requested = URL.parse(requestUrl)?.hostname;
  return requested !== undefined && requested === new URL(origin).hostname;
}

/**
 * robots.txt for a request to `requestUrl`: everything may be crawled on
 * production, which points crawlers to its sitemap; nothing elsewhere.
 */
export function robotsTxt(requestUrl: string, origin: string): string {
  const lines = isProductionHost(requestUrl, origin)
    ? ["User-agent: *", "Allow: /", "", `Sitemap: ${origin}/sitemap.xml`]
    : ["User-agent: *", "Disallow: /"];
  return `${lines.join("\n")}\n`;
}
