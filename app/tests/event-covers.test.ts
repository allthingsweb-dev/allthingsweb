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
import { readBodyAtMost } from "../src/lib/event-covers/read-body";

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
): CoverIngestionDependencies & { stored: string[]; removed: string[] } {
  const stored: string[] = [];
  const removed: string[] = [];
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
    remove: async (key) => {
      removed.push(key);
    },
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    now: () => 0,
    ...overrides,
    stored,
    removed,
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
  return row;
}

describe("event cover ingestion", () => {
  test("saves covers through a driver without interactive transactions", async () => {
    // Production uses drizzle's neon-http driver, which rejects
    // db.transaction(); ingestion must work with select and execute alone.
    await insertEvent("http-driver");
    const httpLike = {
      select: db.select.bind(db),
      execute: db.execute.bind(db),
      transaction: () => {
        throw new Error("No transactions support in neon-http driver");
      },
    };
    const result = await ingestMissingCovers(deps({ database: httpLike }));
    expect(result).toEqual({
      ingested: ["http-driver"],
      withoutCover: [],
      failed: [],
    });
  });

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
    expect(updated.images).toMatchObject({
      alt: "effect event cover",
      width: 800,
      height: 800,
      url: `https://bucket.example/events/${event.id}/cover-${updated.images.id}.png`,
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
    await insertEvent("has-cover", { previewImage: manual.id });
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
    const d = deps({
      store: async (key) => {
        d.stored.push(key);
        await db
          .update(eventsTable)
          .set({ previewImage: manual.id })
          .where(eq(eventsTable.id, event.id));
        return `https://bucket.example/${key}`;
      },
    });
    const result = await ingestMissingCovers(d);
    expect(result.ingested).toEqual([]);
    const [row] = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, event.id));
    expect(row.previewImage).toBe(manual.id);
    expect(await db.select().from(imagesTable)).toHaveLength(1);
    expect(d.removed).toEqual(d.stored);
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

  test("hands one cancellation signal to the lookup, download and upload", async () => {
    await insertEvent("signals");
    const controller = new AbortController();
    const seen: AbortSignal[] = [];
    await ingestMissingCovers(
      deps({
        findCoverUrl: async ({ lumaEventId }, { signal }) => {
          seen.push(signal);
          return `https://images.lumacdn.com/${lumaEventId}.png`;
        },
        download: async (_url, { signal }) => {
          seen.push(signal);
          return new Uint8Array([1]);
        },
        store: async (key, _image, { signal }) => {
          seen.push(signal);
          return `https://bucket.example/${key}`;
        },
      }),
      { signal: controller.signal },
    );
    expect(seen).toEqual([
      controller.signal,
      controller.signal,
      controller.signal,
    ]);
  });

  test("once cancelled, saves nothing, deletes the upload and starts no other event", async () => {
    await insertEvent("cancelled", {
      startDate: new Date("2026-10-03T00:00:00Z"),
    });
    await insertEvent("never-started");
    const controller = new AbortController();
    const d = deps({
      store: async (key) => {
        d.stored.push(key);
        controller.abort(new Error("Route deadline"));
        return `https://bucket.example/${key}`;
      },
    });
    const result = await ingestMissingCovers(d, { signal: controller.signal });
    expect(result).toEqual({
      ingested: [],
      withoutCover: [],
      failed: [{ slug: "cancelled", error: "Route deadline" }],
    });
    expect(d.stored).toHaveLength(1);
    expect(d.removed).toEqual(d.stored);
    expect(await db.select().from(imagesTable)).toHaveLength(0);
  });

  test("deletes the stored image when saving it as the cover fails", async () => {
    await insertEvent("db-down");
    const d = deps({
      newId: () => "not-a-uuid",
    });
    const result = await ingestMissingCovers(d);
    expect(result.ingested).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(d.stored).toHaveLength(1);
    expect(d.removed).toEqual(d.stored);
  });

  test("reports an unused image it could not delete", async () => {
    await insertEvent("db-down");
    const result = await ingestMissingCovers(
      deps({
        newId: () => "not-a-uuid",
        remove: async () => {
          throw new Error("Storage unavailable");
        },
      }),
    );
    expect(result.failed.map((failure) => failure.error)).toContainEqual(
      expect.stringContaining("Could not delete unused cover"),
    );
  });
});

describe("reading a cover download", () => {
  const stream = (...chunks: number[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const size of chunks) controller.enqueue(new Uint8Array(size));
        controller.close();
      },
    });

  test("returns the whole body when it is within the limit", async () => {
    const bytes = await readBodyAtMost(new Response(stream(3, 4)), 10);
    expect(bytes.byteLength).toBe(7);
  });

  test("stops reading as soon as the body passes the limit", async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(4));
      },
    });
    await expect(readBodyAtMost(new Response(endless), 10)).rejects.toThrow(
      "larger than",
    );
    expect(pulled).toBeLessThan(10);
  });

  test("rejects a declared length over the limit without reading", async () => {
    const response = new Response(stream(4), {
      headers: { "content-length": "11" },
    });
    await expect(readBodyAtMost(response, 10)).rejects.toThrow("larger than");
  });
});
