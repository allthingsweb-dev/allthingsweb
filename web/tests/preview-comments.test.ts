import { afterAll, describe, expect, test } from "bun:test";
import {
  DRAFT_COLLAB,
  grantStatements,
} from "../../infra/scripts/draft-collab.ts";
import { provisionLoginRole } from "../../infra/scripts/login-role.ts";
import type { KeySource } from "../src/preview/access.ts";
import { makePreviewHandler, writeLimits } from "../src/preview/app.ts";
import { formToken, isFormToken, sameOrigin } from "../src/preview/forms.ts";
import { eventDatabase, longSlugs } from "./support/event-catalog.ts";
import { serve } from "./support/socket.ts";

/**
 * Comments, the first thing collaborators write in the draft preview
 * (core/README.md, "Collaborating on a draft"): what a form must be to be
 * taken, and that every refusal writes nothing but its line in the audit.
 * The catalog is served as Postgres with draft_collab made by its own
 * script, so the tables' row security holds the writes too. Everyone here
 * is made up in this file.
 */

const team = "allthings-test.cloudflareaccess.com";
const audience = "preview-audience";
const organizer = "erik@example.com";
const now = Date.UTC(2026, 9, 6, 12);
const seconds = now / 1000;
const formKey = "test-only-form-key-0123456789abcdef0123456789";
const origin = "https://preview.example";

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

const signedAt = seconds - 60;

/** A token as Access signs one, for `email`, signed in at `iat`. */
const token = async (email: string, iat = signedAt): Promise<string> => {
  const header = encode({ alg: "RS256", kid: "k", typ: "JWT" });
  const payload = encode({
    iss: `https://${team}`,
    aud: [audience],
    email,
    iat,
    nbf: iat,
    exp: seconds + 3600,
  });
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
};

const draft = "e0000000-0000-4000-8000-000000000506";
const upcoming = "e0000000-0000-4000-8000-000000000501";
const round5 = "f1000000-0000-4000-8000-000000000005";
const round6 = "f1000000-0000-4000-8000-000000000006";
const section = "f2000000-0000-4000-8000-000000000001";
const hostsOnly = "f2000000-0000-4000-8000-000000000002";

const db = await eventDatabase(new Date(now));
await db.exec(`
  INSERT INTO planning.rounds (id, event_id, position, title) VALUES
    ('${round5}', '${draft}', 5, 'AI'), ('${round6}', '${draft}', 6, 'Agents');
  INSERT INTO planning.collaborators (event_id, email, name, role, round_id, invited_at, expires_at, revoked_at) VALUES
    ('${draft}', 'carol@example.com', 'Carol', 'commenter', NULL, now() - interval '1 day', now() + interval '30 days', NULL),
    ('${draft}', 'vic@example.com', 'Vic', 'viewer', NULL, now() - interval '1 day', now() + interval '30 days', NULL),
    ('${draft}', 'simon@example.com', 'Simon', 'round_host', '${round5}', now() - interval '1 day', now() + interval '30 days', NULL),
    ('${draft}', 'busy@example.com', 'Busy', 'commenter', NULL, now() - interval '1 day', now() + interval '30 days', NULL),
    ('${draft}', 'gone@example.com', 'Gone', 'commenter', NULL, now() - interval '2 days', now() + interval '30 days', now() - interval '1 day'),
    ('${upcoming}', 'carol@example.com', 'Carol', 'commenter', NULL, now() - interval '1 day', now() + interval '30 days', NULL);
  INSERT INTO planning.brief_sections (id, event_id, position, heading, body, audiences) VALUES
    ('${section}', '${draft}', 1, 'The pitch', 'Hard.', '{viewer,commenter,round_host,venue}'),
    ('${hostsOnly}', '${draft}', 2, 'Writing your round', 'Eight and one.', '{round_host}');
`);
// Someone who has already written as much as the limits allow.
for (let i = 0; i < writeLimits.tenMinutes; i++) {
  await db.exec(
    `INSERT INTO planning.collab_audit (actor_email, event_id, action, outcome, at) VALUES ('busy@example.com', '${draft}', 'comment.add', 'ok', now() - interval '1 minute')`,
  );
}
await provisionLoginRole(
  {
    unsafe: async (query, values) =>
      (await db.query(query, values === undefined ? [] : [...values])).rows,
  },
  DRAFT_COLLAB,
  "test-only",
);
for (const statement of grantStatements()) await db.exec(statement);
const database = await serve(db);
afterAll(() => database.stop());

const handler = makePreviewHandler(
  {
    ORIGIN: "https://allthings.dev",
    PUBLIC_URL: "https://site.example",
    ACCESS_TEAM_DOMAIN: team,
    ACCESS_AUD: audience,
    PREVIEW_VIEWERS: organizer,
    DATABASE_URL: database.url,
    COLLAB_DATABASE_URL: database.url,
    COLLAB_FORM_KEY: formKey,
  },
  { keys, now: () => now },
);

const page = async (email: string, slug: string = longSlugs.draft) => {
  const response = await handler(
    new Request(`${origin}/${slug}`, {
      headers: { "cf-access-jwt-assertion": await token(email) },
    }),
  );
  return { response, html: await response.text() };
};

/** The comment form's token on the page `email` sees, if it shows one. */
const pageToken = async (email: string, slug?: string) =>
  /name="token" value="([^"]+)"/.exec((await page(email, slug)).html)?.[1];

interface Post {
  readonly email: string;
  readonly fields?: Record<string, string>;
  readonly raw?: string;
  readonly headers?: Record<string, string>;
  readonly slug?: string;
  readonly iat?: number;
}

const post = async ({
  email,
  fields = {},
  raw,
  headers = {},
  slug = longSlugs.draft,
  iat,
}: Post) => {
  const body = raw ?? new URLSearchParams(fields).toString();
  return handler(
    new Request(`${origin}/${slug}/comments`, {
      method: "POST",
      body,
      headers: {
        "cf-access-jwt-assertion": await token(email, iat),
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(new TextEncoder().encode(body).byteLength),
        origin,
        "cf-ray": "ray-test",
        ...headers,
      },
      redirect: "manual",
    }),
  );
};

const comments = async () =>
  (
    await db.query<{ body: string; author_name: string; author_email: string }>(
      `SELECT body, author_name, author_email FROM planning.comments ORDER BY created_at, id`,
    )
  ).rows;

const audit = async (email: string) =>
  (
    await db.query<{
      outcome: string;
      detail: string | null;
      request_id: string | null;
    }>(
      `SELECT outcome, detail, request_id FROM planning.collab_audit
       WHERE actor_email = $1 ORDER BY at, id`,
      [email],
    )
  ).rows;

/** Expects nothing was written but a refusal in the audit, with `reason`. */
const refusedWith = async (
  response: Response,
  status: number,
  email: string,
  reason: string,
  before: number,
) => {
  expect(response.status).toBe(status);
  expect(await response.text()).toBe(`Your comment wasn't saved: ${reason}`);
  expect((await comments()).length).toBe(before);
  const last = (await audit(email)).at(-1);
  expect(last?.detail).toBe(reason);
  expect(["refused", "invalid", "limited"]).toContain(last?.outcome ?? "");
};

describe("a comment that is taken", () => {
  test("goes in, redirects back, and the page says so", async () => {
    const tokenValue = await pageToken("carol@example.com");
    expect(tokenValue).toBeDefined();
    const response = await post({
      email: "carol@example.com",
      fields: {
        token: tokenValue ?? "",
        on: "evening",
        body: "  Which floor?\r\nThe 12th or the 18th?  ",
      },
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `/${longSlugs.draft}?said=comment#collab-comments`,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await comments()).toEqual([
      {
        body: "Which floor?\nThe 12th or the 18th?",
        author_name: "Carol",
        author_email: "carol@example.com",
      },
    ]);
    expect((await audit("carol@example.com")).at(-1)).toEqual({
      outcome: "ok",
      detail: null,
      request_id: "ray-test",
    });
    const after = await handler(
      new Request(`${origin}/${longSlugs.draft}?said=comment`, {
        headers: {
          "cf-access-jwt-assertion": await token("carol@example.com"),
        },
      }),
    );
    const html = await after.text();
    expect(html).toContain("Your comment is in.");
    expect(html).toContain("Which floor?\nThe 12th or the 18th?");
  });

  test("on a section they read, or the round they host", async () => {
    const carol = await pageToken("carol@example.com");
    expect(
      (
        await post({
          email: "carol@example.com",
          fields: {
            token: carol ?? "",
            on: `section:${section}`,
            body: "Love it.",
          },
        })
      ).status,
    ).toBe(303);
    const simon = await pageToken("simon@example.com");
    expect(
      (
        await post({
          email: "simon@example.com",
          fields: {
            token: simon ?? "",
            on: `round:${round5}`,
            body: "Draft is in.",
          },
        })
      ).status,
    ).toBe(303);
  });

  test("from the page itself, said by Sec-Fetch-Site when there's no Origin", async () => {
    const carol = await pageToken("carol@example.com");
    const response = await post({
      email: "carol@example.com",
      fields: { token: carol ?? "", on: "evening", body: "No Origin header." },
      headers: { origin: "", "sec-fetch-site": "same-origin" },
    });
    // An empty Origin header is still an Origin: refused, which the next
    // request without one at all shows the other way.
    expect(response.status).toBe(403);
    const bare = await handler(
      new Request(`${origin}/${longSlugs.draft}/comments`, {
        method: "POST",
        body: new URLSearchParams({
          token: carol ?? "",
          on: "evening",
          body: "Same site.",
        }).toString(),
        headers: {
          "cf-access-jwt-assertion": await token("carol@example.com"),
          "content-type": "application/x-www-form-urlencoded",
          "content-length": String(
            new URLSearchParams({
              token: carol ?? "",
              on: "evening",
              body: "Same site.",
            }).toString().length,
          ),
          "sec-fetch-site": "same-origin",
        },
        redirect: "manual",
      }),
    );
    expect(bare.status).toBe(303);
  });

  test("from an organizer the stack names, as allthings", async () => {
    const erik = await pageToken(organizer);
    expect(
      (
        await post({
          email: organizer,
          fields: {
            token: erik ?? "",
            on: `round:${round6}`,
            body: "Organizers see every round.",
          },
        })
      ).status,
    ).toBe(303);
    expect((await comments()).at(-1)).toMatchObject({
      author_name: "allthings",
      author_email: organizer,
    });
  });
});

describe("a comment that is refused writes nothing but the audit's line", () => {
  test("from another site", async () => {
    const before = (await comments()).length;
    const carol = await pageToken("carol@example.com");
    for (const headers of [
      { origin: "https://evil.example" },
      { origin: "https://preview.example.evil.example" },
    ]) {
      await refusedWith(
        await post({
          email: "carol@example.com",
          fields: { token: carol ?? "", on: "evening", body: "x" },
          headers,
        }),
        403,
        "carol@example.com",
        "it didn't come from this page.",
        before,
      );
    }
    const neither = await handler(
      new Request(`${origin}/${longSlugs.draft}/comments`, {
        method: "POST",
        body: "on=evening&body=x",
        headers: {
          "cf-access-jwt-assertion": await token("carol@example.com"),
          "content-type": "application/x-www-form-urlencoded",
          "content-length": "17",
        },
      }),
    );
    expect(neither.status).toBe(403);
  });

  test("with a token for another evening, another session, or none", async () => {
    const before = (await comments()).length;
    const other = await pageToken("carol@example.com", longSlugs.upcoming);
    for (const [tokenValue, iat] of [
      [other ?? "", signedAt],
      [(await pageToken("carol@example.com")) ?? "", signedAt - 600],
      ["", signedAt],
      ["A".repeat(43), signedAt],
    ] as const) {
      const response = await post({
        email: "carol@example.com",
        fields: { token: tokenValue, on: "evening", body: "x" },
        iat,
      });
      await refusedWith(
        response,
        403,
        "carol@example.com",
        "the form is out of date. Reload the page and try again.",
        before,
      );
    }
  });

  test("from a viewer, or on a round they don't host, or a section they can't read", async () => {
    const before = (await comments()).length;
    expect((await page("vic@example.com")).html).not.toContain('name="token"');
    const vic = await formToken(formKey, {
      email: "vic@example.com",
      eventId: draft,
      form: "comment",
      issuedAt: signedAt,
    });
    await refusedWith(
      await post({
        email: "vic@example.com",
        fields: { token: vic, on: "evening", body: "x" },
      }),
      403,
      "vic@example.com",
      "you can't comment there.",
      before,
    );
    const simon = await pageToken("simon@example.com");
    await refusedWith(
      await post({
        email: "simon@example.com",
        fields: { token: simon ?? "", on: `round:${round6}`, body: "x" },
      }),
      403,
      "simon@example.com",
      "you can't comment there.",
      before,
    );
    const carol = await pageToken("carol@example.com");
    await refusedWith(
      await post({
        email: "carol@example.com",
        fields: { token: carol ?? "", on: `section:${hostsOnly}`, body: "x" },
      }),
      403,
      "carol@example.com",
      "you can't comment there.",
      before,
    );
  });

  test("revoked, or on an evening they aren't on", async () => {
    const before = (await comments()).length;
    const gone = await formToken(formKey, {
      email: "gone@example.com",
      eventId: draft,
      form: "comment",
      issuedAt: signedAt,
    });
    await refusedWith(
      await post({
        email: "gone@example.com",
        fields: { token: gone, on: "evening", body: "x" },
      }),
      404,
      "gone@example.com",
      "there is no such evening for you.",
      before,
    );
  });

  test("over the rate", async () => {
    const before = (await comments()).length;
    const busy = await pageToken("busy@example.com");
    await refusedWith(
      await post({
        email: "busy@example.com",
        fields: { token: busy ?? "", on: "evening", body: "One more." },
      }),
      429,
      "busy@example.com",
      "that's a lot at once. Try again later.",
      before,
    );
  });

  test("to a path whose encoding doesn't decode, as no evening", async () => {
    const response = await handler(
      new Request(`${origin}/%E0/comments`, {
        method: "POST",
        body: "on=evening&body=x",
        headers: {
          "cf-access-jwt-assertion": await token("carol@example.com"),
          "content-type": "application/x-www-form-urlencoded",
          "content-length": "17",
          origin,
        },
      }),
    );
    expect(response.status).toBe(404);
  });

  test("malformed: its fields, its encoding, its size", async () => {
    const before = (await comments()).length;
    const carol = (await pageToken("carol@example.com")) ?? "";
    const shape =
      "a comment is 1 to 2000 characters of text, on the evening, a section or a round.";
    for (const fields of [
      { token: carol, on: "evening", body: "x".repeat(2001) },
      { token: carol, on: "evening", body: "   " },
      { token: carol, on: "evening", body: "bell\u0007" },
      { token: carol, on: "everywhere", body: "x" },
      { token: carol, on: "round:not-an-id", body: "x" },
    ]) {
      await refusedWith(
        await post({ email: "carol@example.com", fields }),
        400,
        "carol@example.com",
        shape,
        before,
      );
    }
    await refusedWith(
      await post({
        email: "carol@example.com",
        raw: `token=${carol}&on=evening&body=a&body=b`,
      }),
      400,
      "carol@example.com",
      "A field came twice.",
      before,
    );
    await refusedWith(
      await post({
        email: "carol@example.com",
        raw: "{}",
        headers: { "content-type": "application/json" },
      }),
      415,
      "carol@example.com",
      "A form is sent URL-encoded.",
      before,
    );
    await refusedWith(
      await post({ email: "carol@example.com", raw: "x".repeat(20_001) }),
      413,
      "carol@example.com",
      "That's too long to send.",
      before,
    );
    await refusedWith(
      await post({
        email: "carol@example.com",
        raw: "on=evening",
        headers: { "content-length": "4" },
      }),
      403,
      "carol@example.com",
      "the form is out of date. Reload the page and try again.",
      before,
    );
  });
});

describe("the page's forms", () => {
  test("post only to the preview, under a policy that still runs no script", async () => {
    const { response, html } = await page("carol@example.com");
    const policy = response.headers.get("content-security-policy") ?? "";
    expect(policy).toContain("form-action 'self'");
    expect(policy).not.toContain("script-src");
    expect(policy).toContain("default-src 'none'");
    expect(html).toContain(`action="/${longSlugs.draft}/comments"`);
  });

  test("carry a token bound to the signer, the evening and the session", async () => {
    const tokenValue = (await pageToken("carol@example.com")) ?? "";
    const parts = {
      email: "carol@example.com",
      eventId: draft,
      form: "comment",
      issuedAt: signedAt,
    };
    expect(await isFormToken(formKey, parts, tokenValue)).toBe(true);
    for (const other of [
      { ...parts, email: "vic@example.com" },
      { ...parts, eventId: upcoming },
      { ...parts, form: "round" },
      { ...parts, issuedAt: signedAt + 1 },
    ]) {
      expect(await isFormToken(formKey, other, tokenValue)).toBe(false);
    }
    expect(
      await isFormToken(
        "another-key-0123456789abcdef0123456789",
        parts,
        tokenValue,
      ),
    ).toBe(false);
  });

  test("aren't shown, nor taken, without the Worker's key", async () => {
    const bare = makePreviewHandler(
      {
        ORIGIN: "https://allthings.dev",
        PUBLIC_URL: "https://site.example",
        ACCESS_TEAM_DOMAIN: team,
        ACCESS_AUD: audience,
        PREVIEW_VIEWERS: organizer,
        DATABASE_URL: database.url,
        COLLAB_DATABASE_URL: database.url,
      },
      { keys, now: () => now },
    );
    const response = await bare(
      new Request(`${origin}/${longSlugs.draft}`, {
        headers: {
          "cf-access-jwt-assertion": await token("carol@example.com"),
        },
      }),
    );
    expect(await response.text()).not.toContain('name="token"');
    const posted = await bare(
      new Request(`${origin}/${longSlugs.draft}/comments`, {
        method: "POST",
        body: "on=evening&body=x",
        headers: {
          "cf-access-jwt-assertion": await token("carol@example.com"),
          "content-type": "application/x-www-form-urlencoded",
          "content-length": "17",
          origin,
        },
      }),
    );
    expect(posted.status).toBe(503);
  });
});

test("sameOrigin reads Origin, then Sec-Fetch-Site, and nothing else", () => {
  const at = (headers: Record<string, string>) =>
    sameOrigin(new Request(`${origin}/x`, { method: "POST", headers }));
  expect(at({ origin })).toBe(true);
  expect(at({ origin: "https://preview.example:8443" })).toBe(false);
  expect(at({ origin: "null" })).toBe(false);
  expect(at({ "sec-fetch-site": "same-origin" })).toBe(true);
  expect(at({ "sec-fetch-site": "same-site" })).toBe(false);
  expect(at({ referer: `${origin}/x` })).toBe(false);
});
