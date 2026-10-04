import { afterAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { isPostgresUuid } from "../src/v1/uuid.ts";

/** The v1 API's helpers, against what they stand in for. */

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
