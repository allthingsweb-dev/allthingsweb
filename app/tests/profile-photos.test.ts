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
import { createSchema } from "./support/schema";
import { eq } from "drizzle-orm";
import { imagesTable, profilesTable } from "../src/lib/schema";
import {
  ingestProfilePhotos,
  profilePhotoKey,
  type ProfilePhotoDependencies,
} from "../src/lib/profile-photos/ingest";

const client = new PGlite();
const db = drizzle(client);

beforeAll(async () => {
  await createSchema(client);
});

beforeEach(async () => {
  await client.exec("TRUNCATE profiles, images CASCADE");
});

afterAll(async () => {
  await client.close();
});

let ids = 0;
function deps(
  overrides: Partial<ProfilePhotoDependencies> = {},
): ProfilePhotoDependencies & { stored: string[]; removed: string[] } {
  const stored: string[] = [];
  const removed: string[] = [];
  return {
    // Only select and execute, like the production neon-http driver.
    database: { select: db.select.bind(db), execute: db.execute.bind(db) },
    download: async () => new Uint8Array([1, 2, 3]),
    process: async (bytes) => ({
      bytes,
      width: 460,
      height: 460,
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

async function insertProfile(
  name: string,
  values: Partial<typeof profilesTable.$inferInsert> = {},
) {
  const [row] = await db
    .insert(profilesTable)
    .values({
      name,
      title: "Speaker",
      bio: "",
      profileType: "member",
      photoSourceUrl: `https://avatars.githubusercontent.com/u/${name.length}?s=800`,
      ...values,
    })
    .returning();
  return row;
}

describe("profile photo ingestion", () => {
  test("stores the photo from its source and sets it on the profile", async () => {
    const profile = await insertProfile("Simon Farshid");
    const downloaded: string[] = [];
    const d = deps({
      download: async (url) => {
        downloaded.push(url);
        return new Uint8Array([1]);
      },
    });
    expect(await ingestProfilePhotos(d)).toEqual({
      ingested: ["Simon Farshid"],
      failed: [],
    });
    expect(downloaded).toEqual([profile.photoSourceUrl!]);
    const [row] = await db
      .select()
      .from(profilesTable)
      .innerJoin(imagesTable, eq(profilesTable.image, imagesTable.id))
      .where(eq(profilesTable.id, profile.id));
    expect(row.images).toMatchObject({
      alt: "Simon Farshid",
      width: 460,
      url: `https://bucket.example/profiles/simon-farshid-${row.images.id}.jpeg`,
    });
  });

  test("names photo keys like the rest of the profiles folder", () => {
    expect(profilePhotoKey("Erik Peña", "abc", "png")).toBe(
      "profiles/erik-peña-abc.png",
    );
  });

  test("keeps URL separators, queries and fragments out of keys", () => {
    expect(profilePhotoKey("Q&A? #1 / Ops", "abc", "png")).toBe(
      "profiles/q-a-1-ops-abc.png",
    );
    expect(profilePhotoKey("???", "abc", "png")).toBe(
      "profiles/profile-abc.png",
    );
  });

  test("never replaces a photo, and skips profiles without a source", async () => {
    const [existing] = await db
      .insert(imagesTable)
      .values({
        url: "https://bucket.example/profiles/existing.png",
        alt: "Existing",
        placeholder: "",
        width: 400,
        height: 400,
      })
      .returning();
    await insertProfile("Has Photo", { image: existing.id });
    await insertProfile("No Source", { photoSourceUrl: null });
    const d = deps();
    expect(await ingestProfilePhotos(d)).toEqual({ ingested: [], failed: [] });
    expect(d.stored).toEqual([]);
  });

  test("yields to a photo set meanwhile and deletes its own upload", async () => {
    const profile = await insertProfile("Race");
    const [manual] = await db
      .insert(imagesTable)
      .values({
        url: "https://bucket.example/profiles/manual.png",
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
          .update(profilesTable)
          .set({ image: manual.id })
          .where(eq(profilesTable.id, profile.id));
        return `https://bucket.example/${key}`;
      },
    });
    expect((await ingestProfilePhotos(d)).ingested).toEqual([]);
    expect(d.removed).toEqual(d.stored);
    expect(await db.select().from(imagesTable)).toHaveLength(1);
  });

  test("skips an empty source and still processes later profiles", async () => {
    await insertProfile("Empty Source", { photoSourceUrl: "" });
    await insertProfile("Later Speaker");
    expect(await ingestProfilePhotos(deps())).toEqual({
      ingested: ["Later Speaker"],
      failed: [],
    });
  });

  test("isolates failures and reports them by name", async () => {
    await insertProfile("Broken");
    await insertProfile("Fine Speaker");
    const result = await ingestProfilePhotos(
      deps({
        download: async (url) => {
          if (url.endsWith(`/${"Broken".length}?s=800`)) {
            throw new Error("Image download failed: 404");
          }
          return new Uint8Array([1]);
        },
      }),
    );
    expect(result).toEqual({
      ingested: ["Fine Speaker"],
      failed: [{ name: "Broken", error: "Image download failed: 404" }],
    });
  });
});
