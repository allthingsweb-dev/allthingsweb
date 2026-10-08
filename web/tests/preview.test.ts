import { afterAll, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  accessSettings,
  type AccessSettings,
  type KeySource,
  publishedKeys,
  verifyAccess,
} from "../src/preview/access.ts";
import {
  makePreviewHandler,
  previewHeaders,
  refusal,
} from "../src/preview/app.ts";
import { eventDatabase, longSlugs, slugs } from "./support/event-catalog.ts";
import { serve } from "./support/socket.ts";

/**
 * The draft preview (src/preview/): who it lets in, checked as Access signs
 * it, and what it shows them, over the event catalog served as Postgres.
 * Tokens are signed here with a key made for the test.
 */

const team = "allthings-test.cloudflareaccess.com";
const audience = "preview-audience";
const viewer = "erik@example.com";
const env = {
  ORIGIN: "https://allthings.dev",
  PUBLIC_URL: "https://site.example",
  ACCESS_TEAM_DOMAIN: team,
  ACCESS_AUD: audience,
  PREVIEW_VIEWERS: `${viewer}, Andre@Example.com`,
};

const encode = (value: unknown): string =>
  Buffer.from(
    typeof value === "string" ? value : JSON.stringify(value),
  ).toString("base64url");

const makeKey = async (kid: string) => {
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
  return {
    kid,
    privateKey: pair.privateKey,
    jwk: { kid, kty: "RSA", n: jwk.n, e: jwk.e },
  };
};

const signing = await makeKey("key-1");
const stranger = await makeKey("key-2");

const now = Date.UTC(2026, 9, 6, 12);
const seconds = now / 1000;

/** A token as Access signs one, with `claims` over the good defaults. */
const token = async (
  claims: Record<string, unknown> = {},
  key = signing,
): Promise<string> => {
  const header = encode({ alg: "RS256", kid: key.kid, typ: "JWT" });
  const payload = encode({
    iss: `https://${team}`,
    aud: [audience],
    email: viewer,
    iat: seconds - 60,
    nbf: seconds - 60,
    exp: seconds + 3600,
    ...claims,
  });
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
};

let fetched = 0;
const keys: KeySource = async () => {
  fetched += 1;
  return [signing.jwk];
};

const settings = accessSettings(env) as AccessSettings;

describe("accessSettings", () => {
  test("reads the stack's bindings, emails lowercase", () => {
    expect(settings).toEqual({
      teamDomain: team,
      audience,
      viewers: new Set([viewer, "andre@example.com"]),
    });
  });

  test("refuses anything missing or malformed", () => {
    expect(accessSettings({ ...env, ACCESS_TEAM_DOMAIN: "evil.example" })).toBe(
      "ACCESS_TEAM_DOMAIN is not an Access team domain",
    );
    expect(accessSettings({ ...env, ACCESS_AUD: " " })).toBe(
      "ACCESS_AUD is not set",
    );
    expect(accessSettings({ ...env, PREVIEW_VIEWERS: "" })).toBe(
      "PREVIEW_VIEWERS is not a list of emails",
    );
    expect(accessSettings({})).toBe(
      "ACCESS_TEAM_DOMAIN is not an Access team domain",
    );
  });
});

describe("verifyAccess", () => {
  const verdict = async (jwt: string | null) =>
    verifyAccess(jwt, settings, keys, now);

  test("lets an organizer in, as one", async () => {
    expect(await verdict(await token())).toEqual({
      allowed: true,
      email: viewer,
      organizer: true,
      issuedAt: seconds - 60,
    });
    expect(
      await verdict(await token({ email: "ANDRE@example.com", aud: audience })),
    ).toEqual({
      allowed: true,
      email: "andre@example.com",
      organizer: true,
      issuedAt: seconds - 60,
    });
  });

  test("signs anyone else in as no organizer: what they see is the database's to say", async () => {
    expect(
      await verdict(await token({ email: "Someone@Example.com" })),
    ).toEqual({
      allowed: true,
      email: "someone@example.com",
      organizer: false,
      issuedAt: seconds - 60,
    });
  });

  for (const [name, make, reason] of [
    ["no token", async () => null, "no Access token"],
    ["garbage", async () => "not.a.jwt", "not a JWT"],
    [
      "an email that isn't one",
      () => token({ email: "nobody" }),
      "not an email",
    ],
    [
      "another application",
      () => token({ aud: ["other"] }),
      "for another application",
    ],
    [
      "another team",
      () => token({ iss: "https://other.cloudflareaccess.com" }),
      "issued by another team",
    ],
    ["an expired token", () => token({ exp: seconds - 3600 }), "expired"],
    [
      "a token for later",
      () => token({ nbf: seconds + 3600 }),
      "not valid yet",
    ],
    ["no email", () => token({ email: undefined }), "no email"],
    [
      "no time it was issued",
      () => token({ iat: undefined }),
      "no time it was issued",
    ],
  ] as const) {
    test(`refuses ${name}`, async () => {
      expect(await verdict(await make())).toEqual({ allowed: false, reason });
    });
  }

  test("refuses a token signed with a key the team doesn't publish, after asking again", async () => {
    const before = fetched;
    expect(await verdict(await token({}, stranger))).toEqual({
      allowed: false,
      reason: "signed with an unknown key",
    });
    expect(fetched - before).toBe(2);
  });

  test("refuses a forged signature", async () => {
    const good = await token();
    const [header, , signature] = good.split(".");
    const forged = `${header}.${encode({ iss: `https://${team}`, aud: audience, email: viewer, exp: seconds + 60 })}.${signature}`;
    expect(await verdict(forged)).toEqual({
      allowed: false,
      reason: "bad signature",
    });
  });

  test("publishedKeys fetches once for requests that ask together, and again after a failure", async () => {
    let calls = 0;
    let fail = true;
    const source = publishedKeys(
      (async () => {
        calls += 1;
        await Bun.sleep(5);
        if (fail) return new Response("down", { status: 503 });
        return Response.json({ keys: [signing.jwk] });
      }) as unknown as typeof fetch,
      () => 0,
    );
    const failed = await Promise.allSettled([
      source(team, false),
      source(team, false),
    ]);
    expect(failed.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(calls).toBe(1);
    fail = false;
    expect(
      await Promise.all([source(team, false), source(team, true)]),
    ).toEqual([[signing.jwk], [signing.jwk]]);
    expect(calls).toBe(2);
  });

  test("publishedKeys keeps the team's keys for an hour, and refetches at most every 30 seconds", async () => {
    let calls = 0;
    let clock = 0;
    const source = publishedKeys(
      (async (url: string) => {
        calls += 1;
        expect(url).toBe(`https://${team}/cdn-cgi/access/certs`);
        return Response.json({ keys: [signing.jwk, { kid: "x", kty: "EC" }] });
      }) as unknown as typeof fetch,
      () => clock,
    );
    expect(await source(team, false)).toEqual([signing.jwk]);
    clock = 3_599_000;
    await source(team, false);
    expect(calls).toBe(1);
    // An unknown key asks again, but not within 30 seconds of the last ask.
    await source(team, true);
    expect(calls).toBe(2);
    clock = 3_620_000;
    await source(team, true);
    expect(calls).toBe(2);
    clock = 7_300_000;
    await source(team, false);
    expect(calls).toBe(3);
  });
});

const database = await serve(await eventDatabase(new Date(now)));
afterAll(() => database.stop());

const handler = makePreviewHandler(
  { ...env, DATABASE_URL: database.url },
  { keys, now: () => now },
);
const get = async (path: string, jwt?: string) =>
  handler(
    new Request(`https://preview.example${path}`, {
      headers: jwt === undefined ? {} : { "cf-access-jwt-assertion": jwt },
      redirect: "manual",
    }),
  );

describe("the preview", () => {
  test("shows nothing, not even the list, without a token Access signed", async () => {
    for (const path of ["/", `/${slugs.draft}`]) {
      for (const jwt of [undefined, await token({ aud: ["other"] })]) {
        const response = await get(path, jwt);
        expect(response.status).toBe(403);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        const body = await response.text();
        expect(body).toBe(refusal);
      }
    }
  });

  test("shows someone signed in but invited to nothing no list, and no draft", async () => {
    const someone = await token({ email: "someone@example.com" });
    const index = await get("/", someone);
    expect(index.status).toBe(403);
    expect(await index.text()).toBe(refusal);
    // A draft answers as a slug nobody has: the public site's.
    const draft = await get(`/${slugs.draft}`, someone);
    expect(draft.status).toBe(302);
    expect(draft.headers.get("location")).toBe(
      `https://site.example/${slugs.draft}`,
    );
    expect(await draft.text()).not.toContain("All Things Draft");
  });

  test("lists the drafts", async () => {
    const response = await get("/", await token());
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain(
      `<a href="/${longSlugs.draft}">All Things Draft</a>`,
    );
    expect(html).not.toContain("Effect");
  });

  test("renders a draft as its page, never stored or crawled", async () => {
    const response = await get(`/${slugs.draft}`, await token());
    expect(response.status).toBe(200);
    for (const [name, value] of Object.entries(previewHeaders)) {
      expect(response.headers.get(name)).toBe(value);
    }
    // Without Accept-Encoding the page is sent as it is.
    const html = await response.text();
    expect(html).toContain("All Things Draft");
  });

  test("sends a published evening, or any other page, to the public site", async () => {
    for (const path of [
      `/${slugs.upcoming}`,
      "/events",
      "/people/erik-thorelli?x=1",
    ]) {
      const response = await get(path, await token());
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        `https://site.example${path}`,
      );
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  test("refuses everyone when its settings are missing", async () => {
    const unset = makePreviewHandler({ DATABASE_URL: database.url }, { keys });
    const response = await unset(
      new Request(`https://preview.example/${slugs.draft}`, {
        headers: { "cf-access-jwt-assertion": await token() },
      }),
    );
    expect(response.status).toBe(503);
  });
});

describe("the public site", () => {
  test("never reads a draft: only src/preview/ names readDraft or Drafts", async () => {
    const source = new URL("../src/", import.meta.url).pathname;
    const files = (await readdir(source, { recursive: true })).filter(
      (file) => /\.(ts|tsx)$/.test(file) && !file.startsWith("preview/"),
    );
    const offending: Array<string> = [];
    for (const file of files) {
      const text = await Bun.file(join(source, file)).text();
      if (/\breadDraft\b|core\/src\/drafts\.ts/.test(text))
        offending.push(file);
    }
    expect(files.length).toBeGreaterThan(20);
    expect(offending).toEqual([]);
  });
});
