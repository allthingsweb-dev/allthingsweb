import { afterAll, describe, expect, test } from "bun:test";
import {
  DRAFT_COLLAB,
  grantStatements,
} from "../../infra/scripts/draft-collab.ts";
import { provisionLoginRole } from "../../infra/scripts/login-role.ts";
import type { KeySource } from "../src/preview/access.ts";
import { makePreviewHandler } from "../src/preview/app.ts";
import { formToken } from "../src/preview/forms.ts";
import { eventDatabase, longSlugs } from "./support/event-catalog.ts";
import { serve } from "./support/socket.ts";

/**
 * What the venue confirms, in the draft preview (core/README.md,
 * "Collaborating on a draft"): the items the studio asked, the venue's
 * answers to them in the panel, and who else sees them. The catalog is
 * served as Postgres with draft_collab made by its own script, so the
 * tables' row security holds every read and write. Everyone here is made
 * up in this file.
 */

const team = "allthings-test.cloudflareaccess.com";
const audience = "preview-audience";
const organizer = "erik@example.com";
const now = Date.UTC(2026, 9, 6, 12);
const seconds = now / 1000;
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
const otherDraft = "e0000000-0000-4000-8000-000000000598";
const projector = "f6000000-0000-4000-8000-000000000001";
const floor = "f6000000-0000-4000-8000-000000000002";
const elsewhere = "f6000000-0000-4000-8000-000000000009";

const db = await eventDatabase(new Date(now));
await db.exec(`
  INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, is_draft, updated_at)
  VALUES ('${otherDraft}', 'another-draft', 'All Things Other Draft', 'Secret', now() + interval '20 days', now() + interval '20 days 3 hours', 0, true, now());
  INSERT INTO planning.collaborators (event_id, email, name, role, invited_at, expires_at) VALUES
    ('${draft}', 'venue@example.com', 'CodeRabbit', 'venue', now() - interval '1 day', now() + interval '30 days'),
    ('${draft}', 'carol@example.com', 'Carol', 'commenter', now() - interval '1 day', now() + interval '30 days'),
    ('${draft}', 'co-organizer@example.com', 'Co-organizer', 'organizer', now() - interval '1 day', now() + interval '30 days'),
    ('${otherDraft}', 'venue@example.com', 'CodeRabbit', 'venue', now() - interval '1 day', now() + interval '30 days');
  INSERT INTO planning.logistics_items (id, event_id, position, label, detail) VALUES
    ('${projector}', '${draft}', 1, 'Projector or large screen with HDMI', NULL),
    ('${floor}', '${draft}', 2, 'Which floor, and the room', 'Luma''s pin says 12th floor'),
    ('${elsewhere}', '${otherDraft}', 1, 'Another evening''s item', NULL);
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

const handler = makePreviewHandler(
  {
    ORIGIN: "https://allthings.dev",
    PUBLIC_URL: "https://site.example",
    ACCESS_TEAM_DOMAIN: team,
    ACCESS_AUD: audience,
    PREVIEW_VIEWERS: organizer,
    DATABASE_URL: database.url,
    COLLAB_DATABASE_URL: database.url,
    COLLAB_FORM_KEY: "test-only-form-key-0123456789abcdef0123456789",
  },
  { keys, now: () => now },
);

const page = async (email: string, query = "") =>
  (
    await handler(
      new Request(`${origin}/${longSlugs.draft}${query}`, {
        headers: { "cf-access-jwt-assertion": await token(email) },
      }),
    )
  ).text();

const logisticsToken = (html: string) =>
  /<input type="hidden" name="token" value="([^"]+)"\/?>\s*<input type="hidden" name="item"/.exec(
    html,
  )?.[1];

const answer = async (
  email: string,
  fields: Record<string, string>,
  tokenValue?: string,
) => {
  const body = new URLSearchParams({
    token: tokenValue ?? logisticsToken(await page(email)) ?? "",
    ...fields,
  }).toString();
  return handler(
    new Request(`${origin}/${longSlugs.draft}/logistics`, {
      method: "POST",
      body,
      headers: {
        "cf-access-jwt-assertion": await token(email),
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(new TextEncoder().encode(body).byteLength),
        origin,
      },
      redirect: "manual",
    }),
  );
};

const confirmations = async () =>
  (
    await db.query<{ item_id: string; answer: string; note: string | null }>(
      `SELECT item_id, answer, note FROM planning.logistics_confirmations ORDER BY created_at, id`,
    )
  ).rows;

describe("the venue", () => {
  test("sees each item, unanswered, with a form to answer it", async () => {
    const html = await page("venue@example.com");
    expect(html).toContain("What the venue confirms");
    expect(html).toContain("Projector or large screen with HDMI");
    expect(html).toContain("Luma&#x27;s pin says 12th floor");
    expect(html).toContain("not answered yet");
    expect(html).toContain(`name="item" value="${projector}"`);
    expect(html).not.toContain("Another evening");
  });

  test("answers an item, and the page says so, with the answer and its note", async () => {
    const response = await answer("venue@example.com", {
      item: floor,
      answer: "yes",
      note: "  18th floor,\r\nthe rooftop room  ",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `/${longSlugs.draft}?said=logistics#collab-logistics`,
    );
    expect(await confirmations()).toEqual([
      { item_id: floor, answer: "yes", note: "18th floor,\nthe rooftop room" },
    ]);
    const html = await page("venue@example.com", "?said=logistics");
    expect(html).toContain("Your answer is in.");
    expect(html).toContain("yes · by CodeRabbit");
    expect(html).toContain("18th floor,\nthe rooftop room");
    const { rows } = await db.query<{ action: string; outcome: string }>(
      `SELECT action, outcome FROM planning.collab_audit WHERE actor_email = 'venue@example.com' ORDER BY at DESC LIMIT 1`,
    );
    expect(rows).toEqual([{ action: "logistics.confirm", outcome: "ok" }]);
  });

  test("answers again, and the latest shows; a note is optional", async () => {
    expect(
      (
        await answer("venue@example.com", {
          item: floor,
          answer: "unsure",
          note: "",
        })
      ).status,
    ).toBe(303);
    expect((await confirmations()).at(-1)).toEqual({
      item_id: floor,
      answer: "unsure",
      note: null,
    });
    expect(await page("venue@example.com")).toContain("unsure · by CodeRabbit");
  });

  test("can't answer another evening's item, or with an answer that isn't one", async () => {
    const before = (await confirmations()).length;
    const other = await answer("venue@example.com", {
      item: elsewhere,
      answer: "yes",
    });
    expect(other.status).toBe(403);
    expect(await other.text()).toBe(
      "Your answer wasn't saved: only the venue answers these.",
    );
    for (const fields of [
      { item: projector, answer: "maybe" },
      { item: "not-an-id", answer: "yes" },
      { item: projector, answer: "yes", note: "x".repeat(1001) },
      { item: projector, answer: "yes", note: "bell\u0007" },
    ]) {
      const response = await answer("venue@example.com", fields);
      expect(response.status).toBe(400);
      expect(await response.text()).toBe(
        "Your answer wasn't saved: an answer is yes, no or unsure, on one of the items, with a note of at most 1000 characters.",
      );
    }
    expect((await confirmations()).length).toBe(before);
  });
});

describe("everyone else", () => {
  test("a commenter sees no item, and can't answer one", async () => {
    const html = await page("carol@example.com");
    expect(html).not.toContain("What the venue confirms");
    expect(html).not.toContain("Projector or large screen");
    // A logistics form's token made for her, as the Worker would: the
    // form is hers to send, and still she may not answer.
    const tokenValue = await formToken(
      "test-only-form-key-0123456789abcdef0123456789",
      {
        email: "carol@example.com",
        eventId: draft,
        form: "logistics",
        issuedAt: seconds - 60,
      },
    );
    const before = (await confirmations()).length;
    const response = await answer(
      "carol@example.com",
      { item: projector, answer: "yes" },
      tokenValue,
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toBe(
      "Your answer wasn't saved: only the venue answers these.",
    );
    expect((await confirmations()).length).toBe(before);
  });

  test("an organizer invited to the evening reads the answers, and can't answer for the venue", async () => {
    const html = await page("co-organizer@example.com");
    expect(html).toContain("What the venue confirms");
    expect(html).not.toContain('name="item"');
    const tokenValue = await formToken(
      "test-only-form-key-0123456789abcdef0123456789",
      {
        email: "co-organizer@example.com",
        eventId: draft,
        form: "logistics",
        issuedAt: seconds - 60,
      },
    );
    const before = (await confirmations()).length;
    const response = await answer(
      "co-organizer@example.com",
      { item: projector, answer: "yes" },
      tokenValue,
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toBe(
      "Your answer wasn't saved: only the venue answers these.",
    );
    expect((await confirmations()).length).toBe(before);
  });

  test("the organizers see every item and its latest answer, with no form", async () => {
    const html = await page(organizer);
    expect(html).toContain("What the venue confirms");
    expect(html).toContain("unsure · by CodeRabbit");
    expect(html).toContain("Projector or large screen with HDMI");
    expect(html).not.toContain('name="item"');
  });
});
