/**
 * Cloudflare Web Analytics on the site's pages: page views, referrers and
 * Core Web Vitals, cookieless, from Cloudflare's beacon. Only prod has a
 * site token (`WEB_ANALYTICS_TOKEN`, from the Web Analytics site
 * infra/alchemy.run.ts declares), so only allthings.dev is measured, never
 * a preview or staging.
 *
 * The Worker adds the beacon to each page it answers 200 (worker.ts), as
 * Cloudflare's own automatic setup would at its edge, which can't reach
 * the site's pages: they are sent compressed, and their policy refuses
 * any script but this site's. So the page's Content-Security-Policy is
 * widened by exactly what the beacon needs, and no more: its script from
 * `static.cloudflareinsights.com` and its reports to
 * `cloudflareinsights.com`. It loads deferred, after the page is drawn,
 * and sets no cookie. The site's own pages stay whole without it.
 *
 * It imports nothing and is kept small: it is one of the Worker's startup
 * modules, which have a budget (tests/support/stack.ts).
 */

/** Where the beacon's script comes from. */
export const beaconScript =
  "https://static.cloudflareinsights.com/beacon.min.js";

/** Where the beacon reports. */
export const beaconReports = "https://cloudflareinsights.com";

/**
 * The site token the Worker is bound with, if it is one: 32 hexadecimal
 * characters, nothing else, so it can go in a page as it is.
 */
export const siteTokenOf = (
  env: Readonly<Record<string, unknown>>,
): string | undefined => {
  const token = env["WEB_ANALYTICS_TOKEN"];
  return typeof token === "string" && /^[0-9a-f]{32}$/.test(token)
    ? token
    : undefined;
};

/** The beacon's element, for the end of a page's body. */
export const beaconElement = (token: string) =>
  `<script defer src="${beaconScript}" data-cf-beacon='{"token":"${token}"}'></script>`;

/**
 * `policy` with the beacon allowed: its script added to `script-src` (made
 * if the page has none) and its reports to `connect-src`, which no page
 * has otherwise. Nothing else in the policy changes.
 */
export const withBeaconPolicy = (policy: string): string =>
  `${
    policy.includes("script-src ")
      ? policy.replace("script-src ", `script-src ${beaconScript} `)
      : `${policy}; script-src ${beaconScript}`
  }; connect-src ${beaconReports}`;

/**
 * `response` with the beacon at the end of its body and its policy
 * widened for it, when it is a page answered 200 and there is a `token`
 * (from {@link siteTokenOf}); otherwise `response` as it was.
 */
export function withBeacon(
  response: Response,
  token: string | undefined,
): Response {
  if (
    token === undefined ||
    response.status !== 200 ||
    !(response.headers.get("content-type") ?? "").startsWith("text/html")
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  const policy = headers.get("content-security-policy");
  if (policy !== null) {
    headers.set("content-security-policy", withBeaconPolicy(policy));
  }
  // The body grows by the beacon.
  headers.delete("content-length");
  return new HTMLRewriter()
    .on("body", {
      element(body) {
        body.append(beaconElement(token), { html: true });
      },
    })
    .transform(
      new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }),
    );
}
