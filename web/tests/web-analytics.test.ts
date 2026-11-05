import { describe, expect, test } from "bun:test";
import {
  contentSecurityPolicy,
  scriptedContentSecurityPolicy,
} from "../src/pages/response.ts";
import {
  beaconElement,
  siteTokenOf,
  withBeacon,
  withBeaconPolicy,
} from "../src/web-analytics.ts";

const token = "b2859e2a475d4efaad1c5a8bfb10f2f2";

const page = (
  init: {
    readonly status?: number;
    readonly type?: string;
    readonly policy?: string;
  } = {},
) =>
  new Response(
    "<!doctype html><html><head></head><body><main>hi</main></body></html>",
    {
      status: init.status ?? 200,
      headers: {
        "content-type": init.type ?? "text/html; charset=utf-8",
        "content-security-policy":
          init.policy ?? contentSecurityPolicy.variants,
        "content-length": "73",
        "cache-control": "public, max-age=60",
      },
    },
  );

describe("siteTokenOf", () => {
  test("is the bound site token when it is one, else nothing", () => {
    expect(siteTokenOf({ WEB_ANALYTICS_TOKEN: token })).toBe(token);
    for (const value of [
      undefined,
      "",
      "not-a-token",
      `${token}"><script>`,
      token.toUpperCase(),
      42,
    ]) {
      expect([value, siteTokenOf({ WEB_ANALYTICS_TOKEN: value })]).toEqual([
        value,
        undefined,
      ]);
    }
  });
});

describe("withBeaconPolicy", () => {
  test("allows the beacon's script and its reports, and changes nothing else", () => {
    expect(withBeaconPolicy(contentSecurityPolicy.variants)).toBe(
      "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src https://static.cloudflareinsights.com/beacon.min.js; connect-src https://cloudflareinsights.com",
    );
  });

  test("adds to a page's own script-src, keeping 'self'", () => {
    const policy = withBeaconPolicy(scriptedContentSecurityPolicy.originals);
    expect(policy).toContain(
      "script-src https://static.cloudflareinsights.com/beacon.min.js 'self';",
    );
    expect(policy.match(/script-src/g)).toHaveLength(1);
    expect(policy).toContain("connect-src https://cloudflareinsights.com");
  });
});

describe("withBeacon", () => {
  test("puts the beacon at the end of a page's body and widens its policy", async () => {
    const answer = withBeacon(page(), token);
    expect(await answer.text()).toBe(
      `<!doctype html><html><head></head><body><main>hi</main>${beaconElement(token)}</body></html>`,
    );
    expect(beaconElement(token)).toBe(
      `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${token}"}'></script>`,
    );
    expect(answer.headers.get("content-security-policy")).toBe(
      withBeaconPolicy(contentSecurityPolicy.variants),
    );
    // The body grew; every other header is as it was.
    expect(answer.headers.get("content-length")).toBeNull();
    expect(answer.headers.get("cache-control")).toBe("public, max-age=60");
    expect(answer.status).toBe(200);
  });

  test("answers a HEAD with the page's widened policy and no body, without the rewriter", async () => {
    const head = new Response(null, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": contentSecurityPolicy.variants,
        "content-length": "73",
      },
    });
    const answer = withBeacon(head, token);
    expect(answer.body).toBeNull();
    expect(answer.headers.get("content-security-policy")).toBe(
      withBeaconPolicy(contentSecurityPolicy.variants),
    );
    expect(answer.headers.get("content-length")).toBeNull();
    expect(await answer.text()).toBe("");
  });

  test("leaves everything else as it was: no token, a failure, a 404, anything but a page", async () => {
    for (const [what, response, given] of [
      ["no token", page(), undefined],
      ["a 404", page({ status: 404 }), token],
      ["a 503", page({ status: 503 }), token],
      ["JSON", page({ type: "application/json" }), token],
      ["a feed", page({ type: "application/rss+xml" }), token],
    ] as const) {
      const answer = withBeacon(response, given);
      expect([what, answer]).toEqual([what, response]);
      expect(await answer.text()).not.toContain("cloudflareinsights");
    }
  });
});
