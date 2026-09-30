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
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/schema";
import { eventsTable, imagesTable } from "../src/lib/schema";
import {
  ingestMissingCovers,
  type CoverIngestionDependencies,
} from "../src/lib/event-covers/ingest";

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
  await client.exec("TRUNCATE events, images CASCADE");
});

afterAll(async () => {
  await client.close();
});

let ids = 0;
function deps(
  overrides: Partial<CoverIngestionDependencies> = {},
): CoverIngestionDependencies & { stored: string[] } {
  const stored: string[] = [];
  return {
    database: db,
    findCoverUrl: async ({ lumaEventId }) =>
      `https://images.lumacdn.com/${lumaEventId}.png`,
    download: async () => new Uint8Array([1, 2, 3]),
    process: async (bytes) => ({
      bytes,
      width: 800,
      height: 800,
      format: "png",
      placeholder: "data:image/png;base64,AA==",
    }),
    store: async (key) => {
      stored.push(key);
      return `https://bucket.example/${key}`;
    },
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    now: () => 0,
    ...overrides,
    stored,
  };
}

async function insertEvent(
  slug: string,
  values: Partial<typeof eventsTable.$inferInsert> = {},
) {
  const [row] = await db
    .insert(eventsTable)
    .values({
      name: slug,
      slug,
      startDate: new Date("2026-09-30T00:30:00Z"),
      endDate: new Date("2026-09-30T03:30:00Z"),
      tagline: "Tagline",
      attendeeLimit: 0,
      lumaEventId: `evt-${slug}`,
      ...values,
    })
    .returning();
  return row!;
}

describe("event cover ingestion", () => {
  test("stores the listing banner and sets it as the event's cover", async () => {
    const event = await insertEvent("effect");
    const d = deps();
    const result = await ingestMissingCovers(d);

    expect(result).toEqual({
      ingested: ["effect"],
      withoutCover: [],
      failed: [],
    });
    const [updated] = await db
      .select()
      .from(eventsTable)
      .innerJoin(imagesTable, eq(eventsTable.previewImage, imagesTable.id))
      .where(eq(eventsTable.id, event.id));
    expect(updated!.images).toMatchObject({
      alt: "effect event cover",
      width: 800,
      height: 800,
      url: `https://bucket.example/events/${event.id}/cover-${updated!.images.id}.png`,
    });
    expect(d.stored).toHaveLength(1);
  });

  test("never replaces a cover that is already set, and skips events without a listing", async () => {
    const [manual] = await db
      .insert(imagesTable)
      .values({
        url: "https://bucket.example/manual.png",
        alt: "Manual cover",
        placeholder: "",
        width: 1200,
        height: 630,
      })
      .returning();
    await insertEvent("has-cover", { previewImage: manual!.id });
    await insertEvent("site-only", { lumaEventId: null });

    const d = deps();
    expect(await ingestMissingCovers(d)).toEqual({
      ingested: [],
      withoutCover: [],
      failed: [],
    });
    expect(d.stored).toHaveLength(0);
  });

  test("yields to a cover set by hand while the banner was downloading", async () => {
    const event = await insertEvent("race");
    const [manual] = await db
      .insert(imagesTable)
      .values({
        url: "https://bucket.example/manual.png",
        alt: "Manual cover",
        placeholder: "",
        width: 1200,
        height: 630,
      })
      .returning();
    const result = await ingestMissingCovers(
      deps({
        store: async (key) => {
          await db
            .update(eventsTable)
            .set({ previewImage: manual!.id })
            .where(eq(eventsTable.id, event.id));
          return `https://bucket.example/${key}`;
        },
      }),
    );
    expect(result.ingested).toEqual([]);
    const [row] = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, event.id));
    expect(row!.previewImage).toBe(manual!.id);
    expect(await db.select().from(imagesTable)).toHaveLength(1);
  });

  test("reports events whose listing has no banner", async () => {
    await insertEvent("no-banner");
    const result = await ingestMissingCovers(
      deps({ findCoverUrl: async () => null }),
    );
    expect(result.withoutCover).toEqual(["no-banner"]);
  });

  test("isolates failures so other events still get covers", async () => {
    await insertEvent("broken", {
      startDate: new Date("2026-10-01T00:00:00Z"),
    });
    await insertEvent("fine");
    const result = await ingestMissingCovers(
      deps({
        download: async (url) => {
          if (url.includes("broken"))
            throw new Error("Cover download failed: 404");
          return new Uint8Array([1]);
        },
      }),
    );
    expect(result.ingested).toEqual(["fine"]);
    expect(result.failed).toEqual([
      { slug: "broken", error: "Cover download failed: 404" },
    ]);
  });

  test("stops starting new events once its time budget is spent", async () => {
    await insertEvent("first", { startDate: new Date("2026-10-02T00:00:00Z") });
    await insertEvent("second");
    let clock = 0;
    const result = await ingestMissingCovers(
      deps({
        now: () => clock,
        download: async () => {
          clock += 50;
          return new Uint8Array([1]);
        },
      }),
      { budgetMs: 10 },
    );
    expect(result.ingested).toEqual(["first"]);
  });
});
