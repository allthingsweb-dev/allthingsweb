import { afterAll, beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import {
  longSlugForShortLink,
  shortLinkForLongSlug,
} from "../src/lib/short-links";
import * as schema from "../src/lib/schema";

/**
 * Short links on the current site: each published event's, current or
 * former, leads to its long slug; nothing else does.
 */

const client = new PGlite();
const db = drizzle(client);
beforeAll(async () => {
  await client.exec("CREATE SCHEMA IF NOT EXISTS neon_auth");
  for (const statement of await generateMigration(
    generateDrizzleJson({}),
    generateDrizzleJson(schema),
  ))
    await client.exec(statement);
  await client.exec(`
    INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, is_draft, updated_at) VALUES
      ('e0000000-0000-4000-8000-000000000001', '2026-09-15-all-things-agent-setups-evt-x', 'All Things Agent Setups', '', now(), now() + interval '3 hours', 0, false, now()),
      ('e0000000-0000-4000-8000-000000000002', '2026-10-01-a-draft', 'A draft', '', now(), now() + interval '3 hours', 0, true, now());
    INSERT INTO event_slugs (slug, event_id) VALUES
      ('setups', 'e0000000-0000-4000-8000-000000000001'),
      ('agent-setups', 'e0000000-0000-4000-8000-000000000001'),
      ('a-draft', 'e0000000-0000-4000-8000-000000000002');
    UPDATE events SET short_slug = 'agent-setups' WHERE id = 'e0000000-0000-4000-8000-000000000001';
    UPDATE events SET short_slug = 'a-draft' WHERE id = 'e0000000-0000-4000-8000-000000000002';
  `);
});
afterAll(async () => {
  await client.close();
});

test("a published event's link, or one it had, leads to its long slug", async () => {
  for (const link of ["agent-setups", "setups"]) {
    expect(await longSlugForShortLink(db, link)).toBe(
      "2026-09-15-all-things-agent-setups-evt-x",
    );
  }
});

test("a draft's link, and any other path, lead nowhere", async () => {
  for (const link of [
    "a-draft",
    "nothing",
    "2026-09-15-all-things-agent-setups-evt-x",
  ]) {
    expect(await longSlugForShortLink(db, link)).toBeNull();
  }
});

test("a published event's long slug leads to its short link, at the cutover", async () => {
  expect(
    await shortLinkForLongSlug(db, "2026-09-15-all-things-agent-setups-evt-x"),
  ).toBe("agent-setups");
  // A draft's, a short link itself, and any other path lead nowhere.
  for (const slug of ["2026-10-01-a-draft", "agent-setups", "nothing"]) {
    expect(await shortLinkForLongSlug(db, slug)).toBeNull();
  }
});
