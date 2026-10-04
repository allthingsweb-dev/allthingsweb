import { afterAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { Option } from "effect";
import { mediaUrl } from "../src/v1/media.ts";
import { isPostgresUuid } from "../src/v1/uuid.ts";

/** The v1 API's helpers, against what they stand in for. */

const app = new URL("../../app/", import.meta.url);
const { toMediaUrl } = (await import(
  new URL("src/lib/media.ts", app).href
)) as { toMediaUrl: (storedUrl: string, storageOrigin: string) => string };

const db = await PGlite.create();
afterAll(() => db.close());

/** Whether Postgres itself reads `value` as a uuid. */
async function postgresReadsUuid(value: string): Promise<boolean> {
  try {
    await db.query("SELECT $1::uuid", [value]);
    return true;
  } catch {
    return false;
  }
}

describe("isPostgresUuid", () => {
  test.each([
    "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11",
    "{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}",
    "a0eebc999c0b4ef8bb6d6bb9bd380a11",
    "a0ee-bc99-9c0b-4ef8-bb6d-6bb9-bd38-0a11",
    "{a0eebc99-9c0b4ef8-bb6d6bb9-bd380a11}",
    "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a1",
    "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a111",
    "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a1-",
    "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11-",
    "-a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "a0e-ebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "a0eebc99--9c0b-4ef8-bb6d-6bb9bd380a11",
    "{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}",
    "{{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}}",
    " a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 ",
    "g0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "2026-08-12-react-at-acme",
    "1",
    "",
  ])("%j as Postgres reads it", async (value) => {
    expect(isPostgresUuid(value)).toBe(await postgresReadsUuid(value));
  });
});

describe("mediaUrl", () => {
  const origin = "https://bucket.s3.us-west-1.amazonaws.com";

  test.each([
    `${origin}/events/e1/cover.png`,
    `${origin}/people/Erik%20Pe%C3%B1a.jpg`,
    `${origin}/people/Erik Peña.jpg`,
    `${origin}/people/देवनागरी.png`,
    `${origin}/a/../b.png`,
    `${origin}/a/%2E%2E/b.png`,
    `${origin}/a%2Fb.png`,
    `${origin}/.hidden.png`,
    `${origin}/bad%zz.png`,
    `${origin}/`,
    `${origin}`,
    `${origin}x/a.png`,
    "https://media.allthings.dev/events/e1/cover.png",
    "/hero-image-rocket.png",
  ])("%j as the app maps it", (url) => {
    expect(mediaUrl(url, Option.some(origin))).toBe(toMediaUrl(url, origin));
  });

  test("leaves URLs alone without a legacy origin", () => {
    const url = `${origin}/events/e1/cover.png`;
    expect(mediaUrl(url, Option.none())).toBe(url);
  });
});
