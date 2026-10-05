import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { DateTime, Effect, Exit, Layer } from "effect";
import {
  grantStatements,
  SITE_SYNC,
  SITE_SYNC_GRANTS,
  SITE_SYNC_SETTINGS,
} from "../../infra/scripts/site-sync.ts";
import {
  provisionLoginRole,
  type Statements,
} from "../../infra/scripts/login-role.ts";
import { ImageIngest } from "../src/ingest/ingest.ts";
import { Luma } from "../src/luma/luma.ts";
import { LumaSync } from "../src/luma/sync.ts";
import { ShortSlugs } from "../src/slugs.ts";
import { clockAt, migratedDatabase, sqlLayer } from "./support/database.ts";
import { configFrom, fakeLuma, fixture, settle } from "./support/luma.ts";
import {
  fakeBucket,
  fakeCovers,
  fakeHosts,
  fakePictures,
  imageBytes,
} from "./support/ingest.ts";

/**
 * site_sync (infra/scripts/site-sync.ts) on a copy of production's schema:
 * the role is created and granted with the script's own statements, then
 * the hourly sync's writes run as it and must succeed, while everything
 * outside its grants must be refused.
 *
 * The sync's writes are core's event sync, its short links and the app's
 * three image ingestions (event covers, profile photos, post images), whose statements
 * the Worker's port keeps. The app's are loaded at runtime, as in
 * luma-parity.test.ts, with downloads, processing and storage faked: only
 * their SQL matters here.
 */

const app = new URL("../../app/", import.meta.url);
const load = (path: string): Promise<unknown> =>
  import(new URL(path, app).href);
const { drizzle } = (await import(
  Bun.resolveSync("drizzle-orm/pglite", app.pathname)
)) as { drizzle: (config: { client: unknown }) => unknown };

interface Ingested {
  readonly ingested: ReadonlyArray<string>;
  readonly failed: ReadonlyArray<unknown>;
}
type Ingest = (
  deps: Record<string, unknown>,
  options?: { budgetMs?: number },
) => Promise<Ingested>;
const { ingestMissingCovers } = (await load(
  "src/lib/event-covers/ingest.ts",
)) as { ingestMissingCovers: Ingest };
const { ingestProfilePhotos } = (await load(
  "src/lib/profile-photos/ingest.ts",
)) as { ingestProfilePhotos: Ingest };
const { ingestPostImages } = (await load("src/lib/post-images/ingest.ts")) as {
  ingestPostImages: Ingest;
};

const calendar = await fixture("calendar.ics");
const stored = await fixture("stored.sql");

/** Rows the image ingestions find missing an image. */
const missingImages = `
  UPDATE profiles SET photo_source_url = 'https://avatars.githubusercontent.com/u/1'
  WHERE id = 'b0000000-0000-4000-8000-000000000001';
  INSERT INTO event_posts (id, event_id, platform, url, author_name, author_avatar_source_url, posted_at, text, image_source_url, updated_at) VALUES
    ('70000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'x', 'https://x.com/a/status/1', 'Ada', 'https://pbs.twimg.com/profile_images/1/a.jpg', '2024-07-30T02:00:00Z', 'What a night', 'https://pbs.twimg.com/media/1.jpg', '2024-07-30T02:00:00Z');
`;

/** The script's connection, as the owner: PGlite behind Bun.SQL's `unsafe`. */
const owner = (database: PGlite): Statements => ({
  unsafe: async (query, values) =>
    (await database.query(query, values === undefined ? [] : [...values])).rows,
});

let db: PGlite;
beforeEach(async () => {
  db = await migratedDatabase();
  await db.exec(stored);
  await db.exec(missingImages);
  await provisionLoginRole(owner(db), SITE_SYNC, "test-only");
  for (const statement of grantStatements()) await db.exec(statement);
  await db.exec(`SET ROLE ${SITE_SYNC}`);
});
afterEach(() => db.close());

/** The message Postgres refuses `statement` with as site_sync, or undefined. */
const refusal = async (statement: string): Promise<string | undefined> => {
  try {
    await db.exec(statement);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

let ids = 0;
const image = {
  bytes: new Uint8Array([1, 2, 3]),
  width: 1200,
  height: 630,
  format: "jpeg",
  placeholder: "data:image/jpeg;base64,AA",
};
/** What every app ingestion needs besides its database: all of it faked. */
const fakes = () => ({
  database: drizzle({ client: db }),
  findCoverUrl: async () => "https://images.lumacdn.com/cover.jpg",
  download: async () => image.bytes,
  process: async () => image,
  store: async (key: string) => `https://media.allthings.dev/${key}`,
  remove: async () => undefined,
  newId: () => `90000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  now: Date.now,
});

describe("site_sync", () => {
  test("runs the event sync", async () => {
    const at = DateTime.makeUnsafe("2026-10-05T12:00:00Z");
    const luma = fakeLuma([{ body: calendar }]);
    const layer = LumaSync.layer.pipe(
      Layer.provide(
        Luma.layer.pipe(
          Layer.provide(Layer.mergeAll(luma.layer, configFrom())),
        ),
      ),
      Layer.provideMerge(sqlLayer(db)),
      Layer.provideMerge(clockAt(at)),
    );
    const exit = await Effect.runPromiseExit(
      settle(LumaSync.use((sync) => sync.run)).pipe(Effect.provide(layer)),
    );
    expect(Exit.isSuccess(exit) ? "ok" : String(exit.cause)).toBe("ok");
    if (Exit.isSuccess(exit)) expect(exit.value.syncedCount).toBeGreaterThan(0);
  });

  test("gives evenings their short links", async () => {
    const result = await Effect.runPromise(
      ShortSlugs.use((slugs) => slugs.assign({ dryRun: false })).pipe(
        Effect.provide(
          ShortSlugs.layer.pipe(
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(
              clockAt(DateTime.makeUnsafe("2026-10-05T12:00:00Z")),
            ),
          ),
        ),
      ),
    );
    expect(result.written).toBeGreaterThan(0);
    expect(result.written).toBe(result.given.length);
  });

  test("stores missing covers, profile photos and post images", async () => {
    const covers = await ingestMissingCovers(fakes());
    expect(covers.failed).toEqual([]);
    expect(covers.ingested.length).toBeGreaterThan(0);

    const photos = await ingestProfilePhotos(fakes());
    expect(photos).toMatchObject({ ingested: ["Ada Lovelace"], failed: [] });

    const posts = await ingestPostImages(fakes());
    expect(posts.failed).toEqual([]);
    expect(posts.ingested).toHaveLength(2);

    await db.exec("RESET ROLE");
    const { rows } = await db.query<{ missing: number }>(`
      SELECT (SELECT count(*) FROM profiles WHERE photo_source_url IS NOT NULL AND image IS NULL)
           + (SELECT count(*) FROM event_posts WHERE image IS NULL OR author_avatar IS NULL)
           + (SELECT count(*) FROM events WHERE luma_event_id IS NOT NULL AND preview_image IS NULL)
           AS missing`);
    expect(Number(rows[0]?.missing)).toBe(0);
  });

  test("runs core's image ingestion, the Worker's", async () => {
    const missing = await db.query<{ luma_event_id: string }>(
      "SELECT luma_event_id FROM events WHERE preview_image IS NULL AND luma_event_id IS NOT NULL",
    );
    const cover = "https://images.lumacdn.com/c.png";
    const layer = ImageIngest.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          fakeBucket().layer,
          fakeCovers(
            Object.fromEntries(
              missing.rows.map(({ luma_event_id }) => [luma_event_id, cover]),
            ),
          ),
          fakePictures,
          fakeHosts({
            [cover]: imageBytes("png", "cover"),
            "https://avatars.githubusercontent.com/u/1": imageBytes(
              "png",
              "ada",
            ),
            "https://pbs.twimg.com/profile_images/1/a.jpg": imageBytes(
              "jpeg",
              "a",
            ),
            "https://pbs.twimg.com/media/1.jpg": imageBytes("jpeg", "night"),
          }).layer,
        ),
      ),
      Layer.provideMerge(sqlLayer(db)),
      Layer.provideMerge(clockAt(DateTime.makeUnsafe("2026-10-05T12:00:00Z"))),
    );
    const [covers, photos, posts] = await Effect.runPromise(
      ImageIngest.use((ingest) =>
        Effect.all([
          ingest.covers({ budget: "40 seconds" }),
          ingest.profilePhotos({ budget: "20 seconds" }),
          ingest.postImages({ budget: "20 seconds" }),
        ]),
      ).pipe(Effect.provide(layer)),
    );
    expect(covers.failed).toEqual([]);
    expect(covers.ingested).toHaveLength(missing.rows.length);
    expect(photos).toEqual({ ingested: ["Ada Lovelace"], failed: [] });
    expect(posts).toMatchObject({ failed: [], remaining: 0 });
    expect(posts.ingested).toHaveLength(2);
  });

  test("may delete nothing", async () => {
    for (const table of ["events", "images", "profiles", "event_posts"]) {
      expect(await refusal(`DELETE FROM ${table}`)).toContain(
        "permission denied",
      );
    }
  });

  test("may not touch tables the sync doesn't", async () => {
    for (const statement of [
      "SELECT 1 FROM talks",
      "SELECT 1 FROM event_people",
      "SELECT 1 FROM sponsors",
      "SELECT 1 FROM redirects",
      "SELECT 1 FROM neon_auth.users_sync",
      `INSERT INTO event_people (event_id, profile_id, role, position, source, created_at, updated_at)
       VALUES ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'host', 0, 'luma', now(), now())`,
      "INSERT INTO profiles (name, title, bio, profile_type, updated_at) VALUES ('x', '', '', 'member', now())",
      "INSERT INTO event_posts (event_id, platform, url, author_name, posted_at, text, updated_at) VALUES ('e0000000-0000-4000-8000-000000000001', 'x', 'u', 'a', now(), 't', now())",
    ]) {
      expect(await refusal(statement)).toContain("permission denied");
    }
  });

  test("may not write the columns organizers own", async () => {
    for (const statement of [
      "UPDATE events SET slug = 'x'",
      "UPDATE events SET tagline = 'x'",
      "DELETE FROM event_slugs",
      "UPDATE event_slugs SET event_id = event_id",
      "UPDATE events SET topic = 'x'",
      "UPDATE events SET recording_url = 'x'",
      "UPDATE profiles SET name = 'x'",
      "UPDATE profiles SET photo_source_url = 'x'",
      "UPDATE event_posts SET status = 'approved'",
      "UPDATE event_posts SET text = 'x'",
      "UPDATE images SET url = 'x'",
      "SELECT bio FROM profiles",
      "SELECT text FROM event_posts",
    ]) {
      expect(await refusal(statement)).toContain("permission denied");
    }
  });

  test("is bounded in time and holds no other attributes", async () => {
    await db.exec("RESET ROLE");
    const { rows } = await db.query<{
      rolsuper: boolean;
      rolinherit: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      rolbypassrls: boolean;
      rolconfig: string[];
    }>(
      `SELECT rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolbypassrls, rolconfig
       FROM pg_roles WHERE rolname = $1`,
      [SITE_SYNC],
    );
    expect(rows[0]).toEqual({
      rolsuper: false,
      rolinherit: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolbypassrls: false,
      rolconfig: Object.entries(SITE_SYNC_SETTINGS).map(
        ([name, value]) => `${name}=${value}`,
      ),
    });
  });

  test("grants only what the list says, and a rerun narrows to it", async () => {
    await db.exec("RESET ROLE");
    await db.exec(`GRANT SELECT, DELETE ON talks, events TO ${SITE_SYNC}`);
    for (const statement of grantStatements()) await db.exec(statement);
    const { rows } = await db.query<{
      table_name: string;
      privilege_type: string;
      column_name: string;
    }>(
      `SELECT table_name, privilege_type, column_name
       FROM information_schema.column_privileges WHERE grantee = $1
       ORDER BY 1, 2, 3`,
      [SITE_SYNC],
    );
    const expected = Object.entries(SITE_SYNC_GRANTS)
      .flatMap(([table, grants]) =>
        (["select", "insert", "update"] as const).flatMap((privilege) =>
          (grants[privilege] ?? []).map((column) => ({
            table_name: table,
            privilege_type: privilege.toUpperCase(),
            column_name: column,
          })),
        ),
      )
      .toSorted(
        (a, b) =>
          a.table_name.localeCompare(b.table_name) ||
          a.privilege_type.localeCompare(b.privilege_type) ||
          a.column_name.localeCompare(b.column_name),
      );
    expect(rows).toEqual(expected);
    const tables = await db.query(
      `SELECT 1 FROM information_schema.table_privileges WHERE grantee = $1`,
      [SITE_SYNC],
    );
    expect(tables.rows).toEqual([]);
  });
});

describe("provisioning site_sync again", () => {
  test("takes back whatever the role was given since", async () => {
    await db.exec("RESET ROLE");
    await db.exec(`CREATE ROLE writer`);
    await db.exec(`GRANT DELETE ON events TO writer`);
    await db.exec(`GRANT writer TO ${SITE_SYNC}`);
    await db.exec(`ALTER ROLE ${SITE_SYNC} INHERIT CREATEDB CREATEROLE`);

    expect(await provisionLoginRole(owner(db), SITE_SYNC, "rotated")).toBe(
      false,
    );
    const { rows } = await db.query(
      `SELECT rolinherit, rolcreatedb, rolcreaterole,
         (SELECT count(*) FROM pg_auth_members m WHERE m.member = r.oid)::int AS memberships
       FROM pg_roles r WHERE rolname = $1`,
      [SITE_SYNC],
    );
    expect(rows[0]).toEqual({
      rolinherit: false,
      rolcreatedb: false,
      rolcreaterole: false,
      memberships: 0,
    });
    await db.exec(`SET ROLE ${SITE_SYNC}`);
    expect(await refusal("DELETE FROM events")).toContain("permission denied");
  });

  test("refuses a role it can't make safe", async () => {
    await db.exec("RESET ROLE");
    await db.exec(`ALTER ROLE ${SITE_SYNC} BYPASSRLS`);
    await expect(
      provisionLoginRole(owner(db), SITE_SYNC, "rotated"),
    ).rejects.toThrow("rolbypassrls");
  });
});
