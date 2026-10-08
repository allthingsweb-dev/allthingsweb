import { afterAll, describe, expect, test } from "bun:test";
import { open } from "allthings-core/src/collab/seal.ts";
import { newAnswersKey } from "../../infra/scripts/collab-answers-key.ts";
import {
  DRAFT_COLLAB,
  grantStatements,
} from "../../infra/scripts/draft-collab.ts";
import { provisionLoginRole } from "../../infra/scripts/login-role.ts";
import type { KeySource } from "../src/preview/access.ts";
import { makePreviewHandler } from "../src/preview/app.ts";
import { parseRoundForm } from "../src/preview/forms.ts";
import { eventDatabase, longSlugs } from "./support/event-catalog.ts";
import { serve } from "./support/socket.ts";

/**
 * Rounds in the draft preview (core/README.md, "Collaborating on a
 * draft"): a host writes their round's questions and answer key, sealed
 * before it is stored, and only they and the organizers ever read it. The
 * catalog is served as Postgres with draft_collab made by its own script,
 * so the tables' row security holds every read and write. Everyone here is
 * made up in this file.
 */

const team = "allthings-test.cloudflareaccess.com";
const audience = "preview-audience";
const organizer = "erik@example.com";
const now = Date.UTC(2026, 9, 6, 12);
const seconds = now / 1000;
const formKey = "test-only-form-key-0123456789abcdef0123456789";
const answersKey = newAnswersKey();
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
const ai = "f1000000-0000-4000-8000-000000000005";
const agents = "f1000000-0000-4000-8000-000000000006";

const db = await eventDatabase(new Date(now));
await db.exec(`
  INSERT INTO planning.rounds (id, event_id, position, title, questions, backups) VALUES
    ('${ai}', '${draft}', 5, 'AI', 2, 1), ('${agents}', '${draft}', 6, 'Agents', 2, 1);
  INSERT INTO planning.collaborators (event_id, email, name, role, round_id, invited_at, expires_at) VALUES
    ('${draft}', 'simon@example.com', 'Simon', 'round_host', '${ai}', now() - interval '1 day', now() + interval '30 days'),
    ('${draft}', 'abhi@example.com', 'Abhi', 'round_host', '${agents}', now() - interval '1 day', now() + interval '30 days'),
    ('${draft}', 'carol@example.com', 'Carol', 'commenter', NULL, now() - interval '1 day', now() + interval '30 days');
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
  COLLAB_FORM_KEY: formKey,
  COLLAB_ANSWERS_KEY: answersKey,
};
const handler = makePreviewHandler(env, { keys, now: () => now });

const page = async (email: string) =>
  (
    await handler(
      new Request(`${origin}/${longSlugs.draft}`, {
        headers: { "cf-access-jwt-assertion": await token(email) },
      }),
    )
  ).text();

const roundToken = (html: string) =>
  /<input type="hidden" name="token" value="([^"]+)"\/?>\s*<input type="hidden" name="round"/.exec(
    html,
  )?.[1];

const question = (n: number, text: string, complete = true) => ({
  [`q${n}_type`]: complete ? "open" : "",
  [`q${n}_question`]: text,
  [`q${n}_answer`]: complete ? `Answer ${n}` : "",
  [`q${n}_also`]: "",
  [`q${n}_source`]: complete ? `https://example.com/${n}` : "",
  [`q${n}_fair`]: complete ? "Documented." : "",
  [`q${n}_difficulty`]: complete ? "deep" : "",
});

const save = async (
  email: string,
  fields: Record<string, string>,
  tokenValue?: string,
) => {
  const html = await page(email);
  const body = new URLSearchParams({
    token: tokenValue ?? roundToken(html) ?? "",
    ...fields,
  }).toString();
  return handler(
    new Request(`${origin}/${longSlugs.draft}/round`, {
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

const stored = async () =>
  (
    await db.query<{
      id: string;
      round_id: string;
      collaborator_id: string;
      stage: "draft" | "final";
      key_id: string;
      nonce: Uint8Array;
      ciphertext: Uint8Array;
    }>(
      `SELECT id, round_id, collaborator_id, stage, key_id, nonce, ciphertext FROM planning.round_submissions ORDER BY created_at, id`,
    )
  ).rows;

describe("a round host", () => {
  test("sees their round's form, and no one else's", async () => {
    const html = await page("simon@example.com");
    expect(html).toContain("Your round: AI");
    expect(html).toContain(`name="round" value="${ai}"`);
    expect(html).not.toContain(`name="round" value="${agents}"`);
    expect(html).toContain('name="q3_question"');
    expect(html).not.toContain('name="q4_question"');
    expect(html).toContain("Nothing saved yet.");
  });

  test("saves a draft, sealed, and finds it in the form again", async () => {
    const response = await save("simon@example.com", {
      round: ai,
      stage: "draft",
      ...question(
        1,
        "In the Transformer paper's base model, what was d_model?",
        false,
      ),
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `/${longSlugs.draft}?said=round#collab-round`,
    );
    const [row] = await stored();
    expect(row?.stage).toBe("draft");
    expect(row?.key_id).toMatch(/^k-[0-9a-f]{8}$/);
    expect(new TextDecoder("latin1").decode(row?.ciphertext)).not.toContain(
      "d_model",
    );
    const html = await page("simon@example.com");
    expect(html).toContain(
      "In the Transformer paper&#x27;s base model, what was d_model?",
    );
    expect(html).toContain("draft saved");
  });

  test("hands it in only whole", async () => {
    const incomplete = await save("simon@example.com", {
      round: ai,
      stage: "final",
      ...question(1, "One"),
      ...question(2, "Two", false),
    });
    expect(incomplete.status).toBe(400);
    expect(await incomplete.text()).toBe(
      "Your round wasn't saved: to hand it in, question 2 needs its type, question, answer, source and difficulty.",
    );
    const whole = await save("simon@example.com", {
      round: ai,
      stage: "final",
      ...question(1, "One"),
      ...question(2, "Two"),
      ...question(3, "The backup"),
    });
    expect(whole.status).toBe(303);
    const last = (await stored()).at(-1);
    expect(last?.stage).toBe("final");
    // It opens, with the Worker's key, for its own row alone.
    const opened = await open(
      [answersKey],
      {
        submissionId: last?.id ?? "",
        eventId: draft,
        roundId: ai,
        collaboratorId: last?.collaborator_id ?? "",
        stage: "final",
      },
      {
        keyId: last?.key_id ?? "",
        nonce: last?.nonce ?? new Uint8Array(),
        ciphertext: last?.ciphertext ?? new Uint8Array(),
      },
    );
    expect(opened?.questions.map((q) => q.question)).toEqual(["One", "Two"]);
    expect(opened?.backups.map((q) => q.question)).toEqual(["The backup"]);
  });

  test("can't save another host's round, nor can anyone else", async () => {
    const before = (await stored()).length;
    const theirs = await save("simon@example.com", {
      round: agents,
      stage: "draft",
      ...question(1, "Sneaky"),
    });
    expect(theirs.status).toBe(403);
    expect(await theirs.text()).toBe(
      "Your round wasn't saved: you don't host that round.",
    );
    const carolHtml = await page("carol@example.com");
    expect(carolHtml).not.toContain('name="round"');
    expect(carolHtml).not.toContain("Your round");
    expect((await stored()).length).toBe(before);
  });
});

describe("who reads a round", () => {
  test("not another host, nor a commenter", async () => {
    for (const email of ["abhi@example.com", "carol@example.com"]) {
      const html = await page(email);
      expect(html).not.toContain("The backup");
      expect(html).not.toContain("Answer 1");
    }
  });

  test("the organizers, every round, read only", async () => {
    const html = await page(organizer);
    expect(html).toContain("Round 5: AI");
    expect(html).toContain("Round 6: Agents");
    expect(html).toContain("handed in");
    expect(html).toContain("Answer: Answer 1");
    expect(html).toContain("Nothing handed in yet.");
  });

  test("each time it is opened, the audit says who", async () => {
    const { rows } = await db.query<{ actor_email: string; outcome: string }>(
      `SELECT actor_email, outcome FROM planning.collab_audit WHERE action = 'round.view' ORDER BY at`,
    );
    expect(
      rows.some((r) => r.actor_email === organizer && r.outcome === "ok"),
    ).toBe(true);
    expect(rows.some((r) => r.actor_email === "simon@example.com")).toBe(true);
    expect(rows.some((r) => r.actor_email === "carol@example.com")).toBe(false);
  });
});

describe("without the answers key", () => {
  test("no round form is shown, and none is taken", async () => {
    const { COLLAB_ANSWERS_KEY: _, ...rest } = env;
    const bare = makePreviewHandler(rest, { keys, now: () => now });
    const html = await (
      await bare(
        new Request(`${origin}/${longSlugs.draft}`, {
          headers: {
            "cf-access-jwt-assertion": await token("simon@example.com"),
          },
        }),
      )
    ).text();
    expect(html).not.toContain('name="round"');
    const body = `round=${ai}&stage=draft`;
    const posted = await bare(
      new Request(`${origin}/${longSlugs.draft}/round`, {
        method: "POST",
        body,
        headers: {
          "cf-access-jwt-assertion": await token("simon@example.com"),
          "content-type": "application/x-www-form-urlencoded",
          "content-length": String(body.length),
          origin,
        },
      }),
    );
    expect(posted.status).toBe(503);
  });
});

describe("parseRoundForm", () => {
  const count = { questions: 1, backups: 1 };
  test("takes a draft with some written, and refuses one with nothing", () => {
    expect(
      parseRoundForm(
        { round: ai, stage: "draft", ...question(1, "Only this", false) },
        count,
      ),
    ).toMatchObject({ ok: true, stage: "draft" });
    expect(parseRoundForm({ round: ai, stage: "draft" }, count)).toEqual({
      ok: false,
      reason: "write at least one question first.",
    });
  });

  test("refuses what the brief's format doesn't have", () => {
    const base = { round: ai, stage: "draft", ...question(1, "Q") };
    for (const [fields, reason] of [
      [{ ...base, stage: "publish" }, "save it as a draft, or hand it in."],
      [{ ...base, round: "five" }, "that isn't a round."],
      [
        { ...base, q1_type: "riddle" },
        "question 1's type isn't one of the brief's.",
      ],
      [
        { ...base, q1_difficulty: "easy" },
        "question 1's difficulty is gettable, deep or brutal.",
      ],
      [
        { ...base, q1_source: "javascript:alert(1)" },
        "question 1's source is an https link.",
      ],
      [
        { ...base, q2_source: "http://example.com" },
        "backup 1's source is an https link.",
      ],
      [
        { ...base, q1_answer: "x".repeat(501) },
        "question 1: a field is over 500 characters, or holds a character that isn't text.",
      ],
      [{ ...base, q9_question: "extra" }, "the form has a field it shouldn't."],
    ] as const) {
      expect(parseRoundForm(fields, count)).toEqual({ ok: false, reason });
    }
  });
});
