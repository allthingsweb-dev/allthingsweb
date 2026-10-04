import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { asc } from "drizzle-orm";
import * as schema from "../src/lib/schema";
import { imagesTable } from "../src/lib/schema";
import {
  copyLegacyImages,
  type LegacyCopyDependencies,
} from "../src/lib/media-store/copy-legacy";

const legacy = "https://old-bucket.s3.us-west-2.amazonaws.com";
const media = "https://media.example.dev";

const client = new PGlite();
const db = drizzle(client);

beforeAll(async () => {
  const statements = await generateMigration(
    generateDrizzleJson({}),
    generateDrizzleJson(schema),
  );
  await client.exec("CREATE SCHEMA IF NOT EXISTS neon_auth");
  for (const statement of statements) await client.exec(statement);
});

beforeEach(async () => {
  await client.exec("TRUNCATE images CASCADE");
});

afterAll(async () => {
  await client.close();
});

let ids = 0;
async function insertImage(url: string, createdAt: Date) {
  await db.insert(imagesTable).values({
    id: `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    url,
    alt: "",
    placeholder: "",
    width: 1,
    height: 1,
    createdAt,
  });
}

const urls = async () =>
  (
    await db
      .select({ url: imagesTable.url })
      .from(imagesTable)
      .orderBy(asc(imagesTable.createdAt))
  ).map((row) => row.url);

function deps(
  overrides: Partial<LegacyCopyDependencies> = {},
): LegacyCopyDependencies & { puts: { key: string; type: string }[] } {
  const puts: { key: string; type: string }[] = [];
  return {
    database: { select: db.select.bind(db), execute: db.execute.bind(db) },
    legacyOrigin: legacy,
    read: async () => ({ body: new Uint8Array([1]), contentType: "image/png" }),
    store: {
      put: async (key, _body, type) => {
        puts.push({ key, type });
        return `${media}/${key.split("/").map(encodeURIComponent).join("/")}`;
      },
    },
    now: () => 0,
    ...overrides,
    puts,
  };
}

describe("copying legacy images into the media store", () => {
  test("copies each legacy image and points its record at the copy", async () => {
    await insertImage(`${legacy}/events/e1/a.png`, new Date(1));
    await insertImage(`${legacy}/profiles/erik-pe%C3%B1a-1.jpg`, new Date(2));
    await insertImage(`${media}/profiles/new.png`, new Date(3));
    const run = deps({
      read: async (key) => ({
        body: new Uint8Array([1]),
        contentType: key.endsWith(".png") ? "image/png" : undefined,
      }),
    });

    const result = await copyLegacyImages(run, { budgetMs: 1_000 });

    expect(result).toEqual({ copied: 2, remaining: 0, failed: [] });
    expect(run.puts).toEqual([
      { key: "events/e1/a.png", type: "image/png" },
      // No stored type: inferred from the extension.
      { key: "profiles/erik-peña-1.jpg", type: "image/jpeg" },
    ]);
    expect(await urls()).toEqual([
      `${media}/events/e1/a.png`,
      `${media}/profiles/erik-pe%C3%B1a-1.jpg`,
      `${media}/profiles/new.png`,
    ]);
  });

  test("leaves an image whose object is missing and reports it", async () => {
    await insertImage(`${legacy}/gone.png`, new Date(1));
    await insertImage(`${legacy}/here.png`, new Date(2));
    const result = await copyLegacyImages(
      deps({
        read: async (key) =>
          key === "gone.png"
            ? null
            : { body: new Uint8Array([1]), contentType: "image/png" },
      }),
      { budgetMs: 1_000 },
    );
    expect(result).toEqual({
      copied: 1,
      remaining: 1,
      failed: [
        { url: `${legacy}/gone.png`, error: "not found in the legacy bucket" },
      ],
    });
    expect(await urls()).toEqual([`${legacy}/gone.png`, `${media}/here.png`]);
  });

  test("stops starting new copies once the budget is spent", async () => {
    await insertImage(`${legacy}/a.png`, new Date(1));
    await insertImage(`${legacy}/b.png`, new Date(2));
    let clock = 0;
    const run = deps({
      now: () => clock,
      store: {
        put: async (key) => {
          clock += 600;
          return `${media}/${key}`;
        },
      },
    });
    const result = await copyLegacyImages(run, { budgetMs: 500 });
    expect(result).toEqual({ copied: 1, remaining: 1, failed: [] });
  });

  test("never overwrites a record that changed during the copy", async () => {
    await insertImage(`${legacy}/a.png`, new Date(1));
    const run = deps({
      store: {
        put: async (key) => {
          // Someone replaces the image while the copy is in flight.
          await client.exec(`UPDATE images SET url = '${media}/replaced.png'`);
          return `${media}/${key}`;
        },
      },
    });
    const result = await copyLegacyImages(run, { budgetMs: 1_000 });
    expect(result.remaining).toBe(0);
    expect(await urls()).toEqual([`${media}/replaced.png`]);
  });
});
