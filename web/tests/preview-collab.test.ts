import { afterAll, describe, expect, test } from "bun:test";
import {
  grantStatements,
  DRAFT_COLLAB,
} from "../../infra/scripts/draft-collab.ts";
import { provisionLoginRole } from "../../infra/scripts/login-role.ts";
import { makePreviewHandler, refusal } from "../src/preview/app.ts";
import type { KeySource } from "../src/preview/access.ts";
import { briefHtml, onlyAllowed } from "../src/preview/brief.ts";
import { eventDatabase, longSlugs } from "./support/event-catalog.ts";
import { serve } from "./support/socket.ts";

/**
 * Collaborating on a draft, as the draft preview shows it (core/README.md,
 * "Collaborating on a draft"): who sees which evening, and the panel under
 * it. The catalog is served as Postgres with draft_collab made by its own
 * script; the Worker reads collaboration as that role, so the tables' row
 * security decides what comes back, as in production. Everyone here is
 * made up in this file.
 */

const team = "allthings-test.cloudflareaccess.com";
const audience = "preview-audience";
const organizer = "erik@example.com";
const now = Date.UTC(2026, 9, 6, 12);
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

/** A token as Access signs one, for `email`. */
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

const draft = "e0000000-0000-4000-8000-000000000506";
const upcoming = "e0000000-0000-4000-8000-000000000501";
const otherDraft = "e0000000-0000-4000-8000-000000000599";
const round = "f1000000-0000-4000-8000-000000000001";

const db = await eventDatabase(new Date(now));
await db.exec(`
  INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, is_draft, updated_at)
  VALUES ('${otherDraft}', 'another-draft', 'All Things Other Draft', 'Secret too', now() + interval '20 days', now() + interval '20 days 3 hours', 0, true, now());
  INSERT INTO planning.rounds (id, event_id, position, title) VALUES ('${round}', '${draft}', 5, 'AI');
  INSERT INTO planning.collaborators (event_id, email, name, role, round_id, invited_at, expires_at, revoked_at) VALUES
    ('${draft}', 'simon@example.com', 'Simon', 'round_host', '${round}', now() - interval '1 day', now() + interval '30 days', NULL),
    ('${draft}', 'venue@example.com', 'Ben at the venue', 'venue', NULL, now() - interval '1 day', now() + interval '30 days', NULL),
    ('${draft}', 'gone@example.com', 'Gone', 'commenter', NULL, now() - interval '2 days', now() + interval '30 days', now() - interval '1 day'),
    ('${upcoming}', 'partner@example.com', 'Promo Partner', 'viewer', NULL, now() - interval '1 day', now() + interval '30 days', NULL);
  INSERT INTO planning.brief_sections (event_id, position, heading, body, audiences) VALUES
    ('${draft}', 1, 'The pitch', 'A **hard** trivia night.', '{viewer,commenter,round_host,venue}'),
    ('${draft}', 2, 'Writing your round', E'### The bar\\n\\n| Kind | Count |\\n| --- | --- |\\n| deep | 4 |\\n\\n<script>alert(1)</script> [run](javascript:alert(1))', '{round_host}'),
    ('${draft}', 3, 'Venues', 'Sentry is busy on Tuesday.', '{organizer}');
  INSERT INTO planning.tasks (event_id, title, due_on, role) VALUES
    ('${draft}', 'First drafts of your 8 + 1', '2026-10-20', 'round_host'),
    ('${draft}', 'Confirm the floor', '2026-10-12', 'venue');
  INSERT INTO planning.comments (event_id, collaborator_id, author_name, author_email, body)
    SELECT '${draft}', id, name, email, '<img src=x onerror=alert(1)> Which floor?'
    FROM planning.collaborators WHERE email = 'venue@example.com';
`);
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

const env = {
  ORIGIN: "https://allthings.dev",
  PUBLIC_URL: "https://site.example",
  ACCESS_TEAM_DOMAIN: team,
  ACCESS_AUD: audience,
  PREVIEW_VIEWERS: organizer,
  DATABASE_URL: database.url,
  COLLAB_DATABASE_URL: database.url,
};
const handler = makePreviewHandler(env, { keys, now: () => now });

const get = async (path: string, email: string) =>
  handler(
    new Request(`https://preview.example${path}`, {
      headers: { "cf-access-jwt-assertion": await token(email) },
      redirect: "manual",
    }),
  );

const page = async (path: string, email: string) => {
  const response = await get(path, email);
  expect(response.status).toBe(200);
  return response.text();
};

describe("who sees which evening", () => {
  test("a collaborator's list is their evenings alone", async () => {
    const html = await page("/", "simon@example.com");
    expect(html).toContain(
      `<a href="/${longSlugs.draft}">All Things Draft</a>`,
    );
    expect(html).not.toContain("another-draft");
    expect(await page("/", "partner@example.com")).toContain(
      `href="/${longSlugs.upcoming}"`,
    );
  });

  test("an evening they aren't invited to answers as a slug nobody has", async () => {
    for (const slug of ["another-draft", "no-such-evening"]) {
      const response = await get(`/${slug}`, "simon@example.com");
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        `https://site.example/${slug}`,
      );
    }
  });

  test("revoked, they see nothing on the next request", async () => {
    const index = await get("/", "gone@example.com");
    expect(index.status).toBe(403);
    expect(await index.text()).toBe(refusal);
    const evening = await get(`/${longSlugs.draft}`, "gone@example.com");
    expect(evening.status).toBe(302);
  });

  test("invited to a published evening, they see its page and the panel", async () => {
    const html = await page(`/${longSlugs.upcoming}`, "partner@example.com");
    expect(html).toContain("Effect San Francisco");
    expect(html).toContain("for collaborators");
    expect(html).toContain("Promo Partner, viewer");
  });

  test("the organizers still see every draft, and the panel on it", async () => {
    const html = await page("/another-draft", organizer);
    expect(html).toContain("All Things Other Draft");
    expect(html).toContain("No one is invited yet.");
  });
});

describe("the panel", () => {
  test("a round host sees their role, their round, their tasks and their sections", async () => {
    const html = await page(`/${longSlugs.draft}`, "simon@example.com");
    expect(html).toContain("All Things Draft");
    expect(html).toContain("Simon, round host");
    expect(html).toContain("You write round 5, AI: 8 questions and 1 backup.");
    expect(html).toContain("by tue, oct 20");
    expect(html).toContain("First drafts of your 8 + 1");
    expect(html).not.toContain("Confirm the floor");
    expect(html).toContain("Writing your round");
    expect(html).toContain("<strong>hard</strong>");
    expect(html).not.toContain("Sentry is busy");
  });

  test("names the others, never their emails", async () => {
    const html = await page(`/${longSlugs.draft}`, "simon@example.com");
    expect(html).toContain("Ben at the venue · venue");
    expect(html).not.toContain("venue@example.com");
    expect(html).not.toContain("Gone");
  });

  test("an organizer sees every section, and the emails", async () => {
    const html = await page(`/${longSlugs.draft}`, organizer);
    expect(html).toContain("Sentry is busy on Tuesday.");
    expect(html).toContain("Ben at the venue · venue · venue@example.com");
  });

  test("what collaborators wrote is escaped, and the brief writes no script or javascript link", async () => {
    const venue = await page(`/${longSlugs.draft}`, "venue@example.com");
    expect(venue).toContain("&lt;img src=x onerror=alert(1)&gt; Which floor?");
    expect(venue).not.toContain("<img src=x");
    const host = await page(`/${longSlugs.draft}`, "simon@example.com");
    expect(host).not.toContain("<script>alert(1)</script>");
    expect(host).not.toContain("javascript:");
    expect(host).toContain("<table>");
    expect(host).toContain("<h4>The bar</h4>");
  });

  test("without the collaboration database, collaborators see nothing", async () => {
    const bare = makePreviewHandler(
      { ...env, COLLAB_DATABASE_URL: "" },
      { keys, now: () => now },
    );
    const response = await bare(
      new Request("https://preview.example/", {
        headers: {
          "cf-access-jwt-assertion": await token("simon@example.com"),
        },
      }),
    );
    expect(response.status).toBe(403);
  });
});

describe("briefHtml", () => {
  test("writes the brief's subheadings, tables, lists and safe links", () => {
    expect(
      briefHtml(
        "### Rules\n\n- one\n- two\n\n| a | b |\n| :-- | --: |\n| 1 | 2 |\n\n[docs](https://example.com) `x`",
      ),
    ).toBe(
      '<h4>Rules</h4>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<table>\n<thead>\n<tr>\n<th align="left">a</th>\n<th align="right">b</th>\n</tr>\n</thead>\n<tbody><tr>\n<td align="left">1</td>\n<td align="right">2</td>\n</tr>\n</tbody></table>\n<p><a href="https://example.com/" target="_blank" rel="noopener noreferrer">docs</a> <code>x</code></p>\n',
    );
  });

  test("drops raw HTML, images and unsafe links", () => {
    const html = briefHtml(
      '<b onclick="x">hi</b> ![x](https://e.com/x.png) [a](javascript:alert(1)) [b](data:text/html,x)',
    );
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:");
    expect(onlyAllowed(html)).toBe(true);
  });

  test("onlyAllowed refuses any other tag or attribute", () => {
    expect(onlyAllowed("<p>ok</p>")).toBe(true);
    expect(onlyAllowed('<p class="x">no</p>')).toBe(false);
    expect(onlyAllowed("<iframe></iframe>")).toBe(false);
    expect(onlyAllowed('<a href="x" onclick="y">no</a>')).toBe(false);
    expect(onlyAllowed('<td align="justify">no</td>')).toBe(false);
    expect(onlyAllowed("<p>a < b</p>")).toBe(false);
  });
});
