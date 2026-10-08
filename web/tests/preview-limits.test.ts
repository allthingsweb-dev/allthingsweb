import { afterAll, expect, test } from "bun:test";
import { SQL } from "bun";
import { PgClient } from "@effect/sql-pg";
import * as Migrations from "allthings-core/src/migrator.ts";
import { Effect, Redacted } from "effect";
import {
  DRAFT_COLLAB,
  grantStatements,
} from "../../infra/scripts/draft-collab.ts";
import { provisionLoginRole } from "../../infra/scripts/login-role.ts";
import type { KeySource } from "../src/preview/access.ts";
import { makePreviewHandler, writeLimits } from "../src/preview/app.ts";
import { eventCatalog, longSlugs } from "./support/event-catalog.ts";

/**
 * The write limits under requests sent all at once, against a real
 * Postgres server (PGlite runs one backend, and can't hold connections at
 * once): each write counts the signer's recent writes in its own
 * transaction, under the signer's advisory lock, so a burst takes no more
 * than the limit. Needs `WEB_TEST_POSTGRES_URL`, a superuser connection
 * string such as CI's service container provides; the test makes its own
 * database there and drops it afterwards.
 */

const serverUrl = process.env["WEB_TEST_POSTGRES_URL"];

if (serverUrl === undefined) {
  test.skip("write limits under a burst (set WEB_TEST_POSTGRES_URL)", () => {});
} else {
  const database = `allthings_web_limits_${process.pid}`;
  const admin = new SQL(serverUrl);
  const url = new URL(serverUrl);
  url.pathname = `/${database}`;
  const now = Date.now();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${database}`);
  await Effect.runPromise(
    Migrations.run().pipe(
      Effect.provide(PgClient.layer({ url: Redacted.make(url.href) })),
    ),
  );
  const sql = new SQL(url.href);
  await sql.unsafe(eventCatalog(new Date(now)));
  await sql.unsafe(`
    INSERT INTO planning.collaborators (event_id, email, name, role, invited_at, expires_at)
    VALUES ('e0000000-0000-4000-8000-000000000506', 'rush@example.com', 'Rush', 'commenter',
      now() - interval '1 day', now() + interval '30 days')`);
  await provisionLoginRole(
    {
      unsafe: (query, values) =>
        sql.unsafe(query, values === undefined ? [] : [...values]),
    },
    DRAFT_COLLAB,
    "test-only",
  );
  for (const statement of grantStatements()) await sql.unsafe(statement);
  afterAll(async () => {
    await sql.close();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.close();
  });

  const team = "allthings-test.cloudflareaccess.com";
  const audience = "preview-audience";
  const origin = "https://preview.example";
  const seconds = Math.floor(now / 1000);
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
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", kid: "k", typ: "JWT" });
  const payload = encode({
    iss: `https://${team}`,
    aud: [audience],
    email: "rush@example.com",
    iat: seconds - 60,
    nbf: seconds - 60,
    exp: seconds + 3600,
  });
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  const jwt = `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;

  const handler = makePreviewHandler(
    {
      ORIGIN: "https://allthings.dev",
      PUBLIC_URL: "https://site.example",
      ACCESS_TEAM_DOMAIN: team,
      ACCESS_AUD: audience,
      PREVIEW_VIEWERS: "erik@example.com",
      DATABASE_URL: url.href,
      COLLAB_DATABASE_URL: url.href,
      COLLAB_FORM_KEY: "test-only-form-key-0123456789abcdef0123456789",
    },
    { keys, now: () => now },
  );

  test("sent all at once, no more than the limit is taken", async () => {
    const html = await (
      await handler(
        new Request(`${origin}/${longSlugs.draft}`, {
          headers: { "cf-access-jwt-assertion": jwt },
        }),
      )
    ).text();
    const token = /name="token" value="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(token).not.toBe("");
    const burst = writeLimits.tenMinutes + 5;
    const responses = await Promise.all(
      Array.from({ length: burst }, (_, i) => {
        const body = new URLSearchParams({
          token,
          on: "evening",
          body: `At once ${i}`,
        }).toString();
        return handler(
          new Request(`${origin}/${longSlugs.draft}/comments`, {
            method: "POST",
            body,
            headers: {
              "cf-access-jwt-assertion": jwt,
              "content-type": "application/x-www-form-urlencoded",
              "content-length": String(body.length),
              origin,
            },
            redirect: "manual",
          }),
        );
      }),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 303)).toHaveLength(
      writeLimits.tenMinutes,
    );
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
    const [row] = (await sql.unsafe(
      `SELECT count(*)::int AS count FROM planning.comments WHERE author_email = 'rush@example.com'`,
    )) as Array<{ count: number }>;
    expect(row?.count).toBe(writeLimits.tenMinutes);
  }, 60_000);
}
