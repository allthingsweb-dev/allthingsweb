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
import { eventPostsTable, eventsTable, imagesTable } from "../src/lib/schema";
import {
  ingestPostImages,
  postImageKey,
  type PostImageDependencies,
  rotate,
  untilAborted,
} from "../src/lib/post-images/ingest";

const client = new PGlite();
const db = drizzle(client);
let eventId = "";

beforeAll(async () => {
  const statements = await generateMigration(
    generateDrizzleJson({}),
    generateDrizzleJson(schema),
  );
  await client.exec("CREATE SCHEMA IF NOT EXISTS neon_auth");
  for (const statement of statements) await client.exec(statement);
});

beforeEach(async () => {
  await client.exec("TRUNCATE event_posts, events, images CASCADE");
  const [event] = await db
    .insert(eventsTable)
    .values({
      name: "Effect",
      slug: "effect",
      tagline: "",
      startDate: new Date("2026-10-01T00:30:00Z"),
      endDate: new Date("2026-10-01T03:30:00Z"),
      attendeeLimit: 0,
    })
    .returning();
  eventId = event.id;
});

afterAll(async () => {
  await client.close();
});

let ids = 0;
function deps(
  overrides: Partial<PostImageDependencies> = {},
): PostImageDependencies & { stored: string[]; removed: string[] } {
  const stored: string[] = [];
  const removed: string[] = [];
  return {
    database: { execute: db.execute.bind(db) },
    download: async () => new Uint8Array([1, 2, 3]),
    process: async (bytes) => ({
      bytes,
      width: 1200,
      height: 800,
      format: "jpeg",
      placeholder: "data:image/jpeg;base64,AA==",
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

let posts = 0;
async function insertPost(
  values: Partial<typeof eventPostsTable.$inferInsert> = {},
) {
  posts += 1;
  const [row] = await db
    .insert(eventPostsTable)
    .values({
      eventId,
      platform: "x",
      url: `https://x.com/i/status/${posts}`,
      authorName: "Andre Landgraf",
      postedAt: new Date("2026-10-01T01:44:59Z"),
      text: "Effect 4.0 shipped IRL!",
      imageSourceUrl: `https://pbs.twimg.com/media/${posts}.jpg`,
      authorAvatarSourceUrl: `https://pbs.twimg.com/profile_images/${posts}.jpg`,
      ...values,
    })
    .returning();
  return row;
}

describe("post image ingestion", () => {
  test("copies a post's photo and its author's avatar into the bucket", async () => {
    const post = await insertPost();
    const downloaded: string[] = [];
    const d = deps({
      download: async (url) => {
        downloaded.push(url);
        return new Uint8Array([1]);
      },
    });
    const result = await ingestPostImages(d);
    expect(result.failed).toEqual([]);
    expect(downloaded).toEqual([
      post.imageSourceUrl!,
      post.authorAvatarSourceUrl!,
    ]);
    const [row] = await db
      .select()
      .from(eventPostsTable)
      .where(eq(eventPostsTable.id, post.id));
    const images = await db.select().from(imagesTable);
    const photo = images.find((i) => i.id === row.image);
    const avatar = images.find((i) => i.id === row.authorAvatar);
    expect(photo).toMatchObject({
      alt: "Photo from Andre Landgraf's post",
      url: `https://bucket.example/posts/${post.id}-image-${photo!.id}.jpeg`,
    });
    expect(avatar).toMatchObject({
      alt: "Andre Landgraf",
      url: `https://bucket.example/posts/${post.id}-avatar-${avatar!.id}.jpeg`,
    });
    expect(result.ingested).toEqual([
      postImageKey(post.id, "image", photo!.id, "jpeg"),
      postImageKey(post.id, "avatar", avatar!.id, "jpeg"),
    ]);
  });

  test("a second run copies nothing; posts without sources are skipped", async () => {
    await insertPost();
    await insertPost({ imageSourceUrl: null, authorAvatarSourceUrl: "" });
    await ingestPostImages(deps());
    const again = deps();
    expect(await ingestPostImages(again)).toEqual({
      ingested: [],
      failed: [],
      remaining: 0,
    });
    expect(again.stored).toEqual([]);
  });

  test("yields to an image set meanwhile and deletes its own upload", async () => {
    const post = await insertPost({ authorAvatarSourceUrl: null });
    const [manual] = await db
      .insert(imagesTable)
      .values({
        url: "https://bucket.example/posts/manual.png",
        alt: "Manual",
        placeholder: "",
        width: 400,
        height: 400,
      })
      .returning();
    const d = deps({
      store: async (key) => {
        d.stored.push(key);
        await db
          .update(eventPostsTable)
          .set({ image: manual.id })
          .where(eq(eventPostsTable.id, post.id));
        return `https://bucket.example/${key}`;
      },
    });
    expect((await ingestPostImages(d)).ingested).toEqual([]);
    expect(d.removed).toEqual(d.stored);
    expect(await db.select().from(imagesTable)).toHaveLength(1);
  });

  test("isolates failures and reports them by source", async () => {
    const broken = await insertPost({ authorAvatarSourceUrl: null });
    await insertPost({ authorAvatarSourceUrl: null });
    const result = await ingestPostImages(
      deps({
        download: async (url) => {
          if (url === broken.imageSourceUrl) {
            throw new Error("Image download failed: 404");
          }
          return new Uint8Array([1]);
        },
      }),
    );
    expect(result.failed).toEqual([
      { url: broken.imageSourceUrl!, error: "Image download failed: 404" },
    ]);
    expect(result.ingested).toHaveLength(1);
  });

  test("stops starting new images once the budget is spent", async () => {
    await insertPost();
    let clock = 0;
    const d = deps({
      now: () => clock,
      download: async () => {
        clock += 10_000;
        return new Uint8Array([1]);
      },
    });
    const result = await ingestPostImages(d, { budgetMs: 5_000 });
    expect(result.ingested).toHaveLength(1);
    // The avatar waits for the next run, and the summary says so.
    expect(result.remaining).toBe(1);
  });

  test("copies at most maxItems in one run, and counts the rest", async () => {
    for (let i = 0; i < 3; i++) await insertPost();
    const result = await ingestPostImages(deps(), { maxItems: 4 });
    expect(result.ingested).toHaveLength(4);
    expect(result.remaining).toBe(2);
    const next = await ingestPostImages(deps(), { maxItems: 4 });
    expect(next.ingested).toHaveLength(2);
    expect(next.remaining).toBe(0);
  });

  test("skips an image that takes longer than its own timeout, and goes on", async () => {
    const slow = await insertPost({ authorAvatarSourceUrl: null });
    await insertPost({ authorAvatarSourceUrl: null });
    const result = await ingestPostImages(
      deps({
        download: (url, { signal }) =>
          url === slow.imageSourceUrl
            ? new Promise<Uint8Array>((_, reject) => {
                signal.addEventListener("abort", () =>
                  reject(
                    new Error(`Download timed out: ${String(signal.reason)}`),
                  ),
                );
              })
            : Promise.resolve(new Uint8Array([1])),
      }),
      { itemTimeoutMs: 20 },
    );
    expect(result.ingested).toHaveLength(1);
    expect(result.failed).toEqual([
      {
        url: slow.imageSourceUrl!,
        error: expect.stringContaining("timed out"),
      },
    ]);
    // The skipped image is still missing: the next run tries it again.
    expect(result.remaining).toBe(1);
  });

  test("bounds processing too, which can't be cancelled", async () => {
    await insertPost({ authorAvatarSourceUrl: null });
    await insertPost({ authorAvatarSourceUrl: null });
    let calls = 0;
    const result = await ingestPostImages(
      deps({
        process: (bytes) =>
          ++calls === 1
            ? new Promise(() => {})
            : Promise.resolve({
                bytes,
                width: 1200,
                height: 800,
                format: "jpeg",
                placeholder: "",
              }),
      }),
      { itemTimeoutMs: 20 },
    );
    expect(result.failed).toHaveLength(1);
    expect(result.ingested).toHaveLength(1);
    expect(result.remaining).toBe(1);
  });

  test("starts each hourly run further along the queue", () => {
    const queue = ["a", "b", "c", "d", "e"];
    const hour = 3_600_000;
    expect(rotate(queue, 0, 2)).toEqual(["a", "b", "c", "d", "e"]);
    expect(rotate(queue, hour, 2)).toEqual(["c", "d", "e", "a", "b"]);
    expect(rotate(queue, 2 * hour + 59_000, 2)).toEqual([
      "e",
      "a",
      "b",
      "c",
      "d",
    ]);
    // A queue a run can finish is taken in order.
    expect(rotate(queue, hour, 5)).toEqual(queue);
  });

  test("failures never keep later images from their turn", async () => {
    for (let i = 0; i < 3; i++) {
      await insertPost({ authorAvatarSourceUrl: null });
    }
    const failing = new Set(
      (
        await db
          .select()
          .from(eventPostsTable)
          .orderBy(eventPostsTable.addedAt, eventPostsTable.id)
      )
        .slice(0, 2)
        .map((post) => post.imageSourceUrl),
    );
    const run = (now: number) =>
      ingestPostImages(
        deps({
          now: () => now,
          download: async (url) => {
            if (failing.has(url)) throw new Error("Image download failed: 404");
            return new Uint8Array([1]);
          },
        }),
        { maxItems: 2 },
      );
    // The first run tries the two failing ones; the next gets to the third.
    expect((await run(0)).ingested).toHaveLength(0);
    expect((await run(3_600_000)).ingested).toHaveLength(1);
  });

  test("untilAborted rejects once the signal aborts, and passes results on", async () => {
    const controller = new AbortController();
    const pending = untilAborted(new Promise(() => {}), controller.signal);
    controller.abort(new Error("timed out"));
    await expect(pending).rejects.toThrow("timed out");
    expect(
      await untilAborted(Promise.resolve(1), new AbortController().signal),
    ).toBe(1);
  });
});
