import { describe, expect, test } from "bun:test";
import { makePreviewHandler, refusal } from "../src/preview/app.ts";
import type { KeySource } from "../src/preview/access.ts";
import {
  analyticsSql,
  notFoundPage,
  notFoundReport,
  windowOf,
} from "../src/preview/not-found.ts";
import type { Row } from "../src/request-queries.ts";

/**
 * The organizers' 404 page on the draft preview, `/404s`: who may see it,
 * what it reads from Analytics Engine, and that it never shows a stored
 * path that isn't a shape (src/not-found.ts). Analytics Engine is a
 * stand-in answering by query.
 */

const team = "allthings-test.cloudflareaccess.com";
const audience = "preview-audience";
const organizer = "erik@example.com";
const now = Date.UTC(2026, 10, 7, 12);
const seconds = now / 1000;

const encode = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const pair = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);
const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as {
  n: string;
  e: string;
};
const keys: KeySource = async () => [
  { kid: "k", kty: "RSA", n: jwk.n, e: jwk.e },
];
const token = async (email: string): Promise<string> => {
  const header = encode({ alg: "RS256", kid: "k", typ: "JWT" });
  const payload = encode({
    iss: `https://${team}`,
    aud: [audience],
    email,
    iat: seconds - 60,
    nbf: seconds - 60,
    exp: seconds + 3600,
  });
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
};

const env = {
  ORIGIN: "https://allthings.dev",
  PUBLIC_URL: "https://site.example",
  ACCESS_TEAM_DOMAIN: team,
  ACCESS_AUD: audience,
  PREVIEW_VIEWERS: organizer,
};

/** Analytics Engine as a stand-in: rows by what the query groups. */
const asked: Array<string> = [];
const analytics = async (sql: string): Promise<ReadonlyArray<Row>> => {
  asked.push(sql);
  if (sql.includes("GROUP BY day, kind")) {
    return [
      { day: "2026-11-06 00:00:00", kind: "probe", requests: "900" },
      { day: "2026-11-06 00:00:00", kind: "", requests: "40" },
      { day: "2026-11-07 00:00:00", kind: "guessed", requests: "12" },
      // Outside the window: not drawn.
      { day: "2026-01-01 00:00:00", kind: "probe", requests: "5" },
    ];
  }
  if (sql.includes("GROUP BY kind, path")) {
    return [
      { kind: "probe", path: "(probe: env)", requests: "800", bots: "800" },
      { kind: "guessed", path: "/press", requests: "12", bots: "3" },
      // A point from before shapes: its class.
      { kind: "", path: "/(other)", requests: "30", bots: "30" },
      // Never shown as it is: not a shape.
      { kind: "", path: "/.env", requests: "10", bots: "10" },
      {
        kind: "guessed",
        path: "/correct-horse-battery",
        requests: "1",
        bots: "0",
      },
    ];
  }
  if (sql.includes("GROUP BY kind")) {
    return [
      { kind: "probe", requests: "900", bots: "900" },
      { kind: "", requests: "40", bots: "40" },
      { kind: "guessed", requests: "12", bots: "3" },
    ];
  }
  return [{ requests: "4000" }];
};

const handler = makePreviewHandler(env, { keys, now: () => now, analytics });
const get = async (path: string, email: string) =>
  handler(
    new Request(`https://preview.example${path}`, {
      headers: { "cf-access-jwt-assertion": await token(email) },
    }),
  );

describe("the 404 page", () => {
  test("shows an organizer the 404s per day, by kind, and the shapes asked most", async () => {
    const response = await get("/404s", organizer);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const html = await response.text();
    expect(html).toContain(
      "<strong>952</strong> requests answered 404 in the last 30 days, 23.8% of the 4,000",
    );
    expect(html).toContain("<code>(probe: env)</code>");
    expect(html).toContain("<code>/press</code>");
    expect(html).toContain("<code>/(other)</code>");
    expect(html).toContain("scanner probe");
    expect(html).toContain("before kinds");
    expect(html).toContain("<title>2026-11-06: 900 scanner probe</title>");
    expect(html).not.toContain("<script");
    expect(asked.every((sql) => sql.includes("FROM allthings_requests "))).toBe(
      true,
    );
  });

  test("never shows a stored path that isn't a shape", async () => {
    const html = await (await get("/404s", organizer)).text();
    expect(html).not.toContain(".env<");
    expect(html).not.toContain("horse");
  });

  test("reads the window ?days= asks for, if the page offers it", async () => {
    asked.length = 0;
    await get("/404s?days=7", organizer);
    expect(asked.every((sql) => sql.includes("INTERVAL '7' DAY"))).toBe(true);
    expect(windowOf(new URL("https://x/404s?days=90"))).toBe(90);
    expect(windowOf(new URL("https://x/404s?days=1000"))).toBe(30);
    expect(windowOf(new URL("https://x/404s?days=x"))).toBe(30);
  });

  test("is refused to anyone but an organizer, and to a request Access didn't sign", async () => {
    const response = await get("/404s", "simon@example.com");
    expect(response.status).toBe(403);
    expect(await response.text()).toBe(refusal);
    const unsigned = await handler(new Request("https://preview.example/404s"));
    expect(unsigned.status).toBe(403);
  });

  test("says it isn't configured without a token, and that Analytics Engine failed when it does", async () => {
    const bare = makePreviewHandler(env, { keys, now: () => now });
    expect(
      (
        await bare(
          new Request("https://preview.example/404s", {
            headers: { "cf-access-jwt-assertion": await token(organizer) },
          }),
        )
      ).status,
    ).toBe(503);
    const failing = makePreviewHandler(env, {
      keys,
      now: () => now,
      analytics: async () => {
        throw new Error("Analytics Engine answered 401");
      },
    });
    const response = await failing(
      new Request("https://preview.example/404s", {
        headers: { "cf-access-jwt-assertion": await token(organizer) },
      }),
    );
    expect(response.status).toBe(502);
  });
});

describe("the report", () => {
  test("has a bar for each UTC day the window touches, oldest first, zero where nothing was asked", async () => {
    const report = await notFoundReport(analytics, 7, now);
    expect(report.daily.map(({ day }) => day)).toEqual([
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
    ]);
    expect(report.daily[6]?.kinds.get("probe")).toBe(900);
    expect(report.daily[0]?.kinds.size).toBe(0);
  });

  test("draws an empty window as one", () => {
    const html = notFoundPage({
      days: 7,
      total: 0,
      daily: [],
      kinds: [],
      top: [],
    });
    expect(html).toContain("<strong>0</strong> requests answered 404");
  });
});

describe("analyticsSql", () => {
  test("posts the query with the token, and names only the status when it fails", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const ok = analyticsSql("t0ken", (async (
      url: string,
      init?: RequestInit,
    ) => {
      calls.push({ url, init });
      return Response.json({ data: [{ requests: "1" }] });
    }) as unknown as typeof fetch);
    expect(await ok("SELECT 1")).toEqual([{ requests: "1" }]);
    expect(calls[0]?.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/af627f300cd00c4dca56aacf05bea050/analytics_engine/sql",
    );
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      "Bearer t0ken",
    );
    const failing = analyticsSql(
      "t0ken",
      (async () =>
        new Response("token t0ken is invalid", {
          status: 401,
        })) as unknown as typeof fetch,
    );
    const message = await failing("SELECT 1").then(
      () => "",
      (cause: Error) => cause.message,
    );
    expect(message).toContain("401");
    expect(message).not.toContain("t0ken");
  });
});

describe("a stalled Analytics Engine", () => {
  test("is given up on by its timeout, and the page answers 502", async () => {
    // Answers only when the request is aborted, as fetch does.
    const stalled = (async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      })) as unknown as typeof fetch;
    const query = analyticsSql("t0ken", stalled, 20);
    await expect(query("SELECT 1")).rejects.toThrow("aborted");
    const page = makePreviewHandler(env, {
      keys,
      now: () => now,
      analytics: analyticsSql("t0ken", stalled, 20),
    });
    const response = await page(
      new Request("https://preview.example/404s", {
        headers: { "cf-access-jwt-assertion": await token(organizer) },
      }),
    );
    expect(response.status).toBe(502);
  });
});
