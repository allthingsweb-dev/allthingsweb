import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { DateTime, Duration, Effect, Exit, Layer, Order } from "effect";
import {
  byFollowers,
  FollowerReadError,
  FollowerSource,
  refreshFollowers,
  xHandleOf,
} from "../src/followers.ts";
import { byFollowers as appByFollowers } from "../../app/src/lib/speaker-directory.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";
import { configFrom, fakeLumaBy, type Reply, settle } from "./support/luma.ts";

/**
 * X follower counts: the order speaker lists take from them, the FixTweet
 * reader against recorded answers, and refreshing snapshots on
 * tests/seed.sql (Ada is @ada, Linus "@linus", Future Speaker @future).
 */

describe("byFollowers", () => {
  interface P {
    readonly name: string;
    readonly followers: number | null;
  }
  const order = byFollowers(
    (p: P) => p.followers,
    Order.mapInput(Order.String, (p: P) => p.name),
  );
  const sorted = (people: ReadonlyArray<P>) =>
    people.toSorted(order).map((p) => p.name);

  test("most followed first; ties and the uncounted fall back to the list's own order, uncounted last", () => {
    expect(
      sorted([
        { name: "eve", followers: null },
        { name: "dan", followers: 10 },
        { name: "cat", followers: 10 },
        { name: "bob", followers: 0 },
        { name: "ann", followers: null },
        { name: "abe", followers: 5_000_000 },
      ]),
    ).toEqual(["abe", "cat", "dan", "bob", "ann", "eve"]);
  });

  test("an empty list, one person, and nobody counted", () => {
    expect(sorted([])).toEqual([]);
    expect(sorted([{ name: "solo", followers: null }])).toEqual(["solo"]);
    expect(
      sorted([
        { name: "b", followers: null },
        { name: "a", followers: null },
      ]),
    ).toEqual(["a", "b"]);
  });
});

describe("the app's speaker order", () => {
  test("is core's, until the app is retired", () => {
    const people = [
      { name: "eve", followers: null },
      { name: "dan", followers: 10 },
      { name: "cat", followers: 10 },
      { name: "bob", followers: 0 },
      { name: "ann", followers: null },
      { name: "abe", followers: 5_000_000 },
    ].toSorted((a, b) => a.name.localeCompare(b.name));
    const core = people.toSorted(
      byFollowers(
        (p) => p.followers,
        Order.mapInput(Order.String, (p: (typeof people)[number]) => p.name),
      ),
    );
    // The app sorts its by-name list stably by followers alone.
    const app = people.toSorted((a, b) =>
      appByFollowers(a.followers, b.followers),
    );
    expect(app.map((p) => p.name)).toEqual(core.map((p) => p.name));
  });
});

describe("xHandleOf", () => {
  test.each([
    ["ada", "ada"],
    [" @Ada_99 ", "Ada_99"],
    ["", null],
    [null, null],
    ["https://x.com/ada", null],
    ["far_too_long_handle_x", null],
  ])("%j is %j", (stored, handle) => {
    expect(xHandleOf(stored)).toBe(handle);
  });
});

const user = (screenName: string, followers: number) =>
  JSON.stringify({
    code: 200,
    user: { screen_name: screenName, followers, name: screenName },
  });

const readWith = (
  handle: string,
  replies: Readonly<Record<string, ReadonlyArray<Reply>>>,
) => {
  const fake = fakeLumaBy((url) => url.pathname, replies);
  return Effect.runPromiseExit(
    settle(FollowerSource.use((source) => source.read(handle))).pipe(
      Effect.provide(
        FollowerSource.fxtwitter.pipe(
          Layer.provide(Layer.mergeAll(fake.layer, configFrom())),
          Layer.provideMerge(clockLayer),
        ),
      ),
    ),
  ).then((exit) => ({ exit, requests: fake.requests }));
};

const failure = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) throw new Error("expected a failure");
  const reason = exit.cause.reasons[0];
  return reason?._tag === "Fail" ? reason.error : reason;
};

describe("FollowerSource.fxtwitter", () => {
  test("reads the count, trying again after a 503", async () => {
    const { exit, requests } = await readWith("ada", {
      "/ada": [{ status: 503 }, { body: user("Ada", 1234) }],
    });
    expect(Exit.isSuccess(exit) ? exit.value : exit).toBe(1234);
    expect(requests.map((r) => r.url)).toEqual([
      "https://api.fxtwitter.com/ada",
      "https://api.fxtwitter.com/ada",
    ]);
  });

  test("refuses a handle it doesn't know, and another account's answer", async () => {
    const missing = await readWith("nobody", {
      "/nobody": [{ status: 404 }],
    });
    expect(failure(missing.exit)).toBeInstanceOf(FollowerReadError);
    expect(missing.requests).toHaveLength(1);
    const other = await readWith("ada", {
      "/ada": [{ body: user("someone_else", 9) }],
    });
    expect((failure(other.exit) as FollowerReadError).reason).toBe(
      "FixTweet served @someone_else (code 200)",
    );
  });
});

const databases: Array<PGlite> = [];
afterAll(() => Promise.all(databases.map((db) => db.close())));

/** A source answering from `counts`, and failing for anyone else. */
const sourceOf = (counts: Readonly<Record<string, number>>) =>
  Layer.succeed(
    FollowerSource,
    FollowerSource.of({
      read: (handle) =>
        counts[handle] === undefined
          ? Effect.fail(
              new FollowerReadError({
                handle,
                reason: "unknown",
                retryable: false,
              }),
            )
          : Effect.succeed(counts[handle]),
    }),
  );

const refresh = (
  db: PGlite,
  counts: Readonly<Record<string, number>>,
  options: Partial<Parameters<typeof refreshFollowers>[0]> = {},
) =>
  Effect.runPromise(
    refreshFollowers({
      dryRun: false,
      maxProfiles: 10,
      staleAfter: "7 days",
      ...options,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(sourceOf(counts), sqlLayer(db), clockLayer),
      ),
    ),
  );

const snapshots = async (db: PGlite) =>
  (
    await db.query<{ name: string; x_followers: number | null }>(
      `SELECT name, x_followers FROM profiles WHERE twitter_handle IS NOT NULL ORDER BY name`,
    )
  ).rows.map((row) => [row.name, row.x_followers]);

describe("refreshFollowers", () => {
  test("stores each count with when it was read; a failed read leaves the snapshot alone", async () => {
    const db = await seededDatabase();
    databases.push(db);
    const report = await refresh(db, { ada: 120, linus: 9000 });
    expect(report.refreshed.toSorted()).toEqual([
      "Ada Lovelace (@ada): ∅ → 120",
      "Linus (@linus): ∅ → 9000",
    ]);
    expect(report.failed).toEqual(["Future Speaker (@future): unknown"]);
    expect(await snapshots(db)).toEqual([
      ["Ada Lovelace", 120],
      ["Future Speaker", null],
      ["Linus", 9000],
    ]);
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM profiles WHERE x_followers IS NOT NULL AND x_followers_at IS NULL`,
    );
    expect(rows[0]?.n).toBe(0);
  });

  test("leaves fresh snapshots alone, and reads the missing ones first, at most as many as asked", async () => {
    const db = await seededDatabase();
    databases.push(db);
    await refresh(db, { ada: 120 });
    // Ada's count is fresh; the two still missing come first, one per run.
    const first = await refresh(
      db,
      { ada: 999, linus: 1, future: 2 },
      { maxProfiles: 1 },
    );
    expect(first.refreshed).toHaveLength(1);
    expect(first.remaining).toBe(1);
    expect(first.refreshed[0]).not.toContain("Ada");
    const second = await refresh(db, { ada: 999, linus: 1, future: 2 });
    expect(second.refreshed).toHaveLength(1);
    expect(second.remaining).toBe(0);
    expect(await snapshots(db)).toEqual([
      ["Ada Lovelace", 120],
      ["Future Speaker", 2],
      ["Linus", 1],
    ]);
  });

  test("a changed or cleared X handle clears its count; other changes keep it", async () => {
    const db = await seededDatabase();
    databases.push(db);
    await refresh(db, { ada: 120, linus: 9000, future: 3 });
    await db.exec(`
      UPDATE profiles SET twitter_handle = 'ada_two' WHERE name = 'Ada Lovelace';
      UPDATE profiles SET twitter_handle = NULL WHERE name = 'Linus';
      UPDATE profiles SET title = 'Speaker' WHERE name = 'Future Speaker';
    `);
    const { rows } = await db.query<{
      name: string;
      x_followers: number | null;
      x_followers_at: Date | null;
    }>(`SELECT name, x_followers, x_followers_at FROM profiles
        WHERE name IN ('Ada Lovelace', 'Linus', 'Future Speaker') ORDER BY name`);
    expect(
      rows.map((row) => [
        row.name,
        row.x_followers,
        row.x_followers_at !== null,
      ]),
    ).toEqual([
      ["Ada Lovelace", null, false],
      ["Future Speaker", 3, true],
      ["Linus", null, false],
    ]);
  });

  test("a count read while its handle changed is not stored", async () => {
    const db = await seededDatabase();
    databases.push(db);
    const changing = Layer.succeed(
      FollowerSource,
      FollowerSource.of({
        read: (handle) =>
          handle === "ada"
            ? Effect.promise(() =>
                db.query(
                  `UPDATE profiles SET twitter_handle = 'ada_two' WHERE name = 'Ada Lovelace'`,
                ),
              ).pipe(Effect.as(120))
            : Effect.fail(
                new FollowerReadError({
                  handle,
                  reason: "unknown",
                  retryable: false,
                }),
              ),
      }),
    );
    const report = await Effect.runPromise(
      refreshFollowers({
        dryRun: false,
        maxProfiles: 10,
        staleAfter: "7 days",
      }).pipe(
        Effect.provide(Layer.mergeAll(changing, sqlLayer(db), clockLayer)),
      ),
    );
    expect(report.refreshed).toEqual([]);
    expect(report.failed).toContain(
      "Ada Lovelace (@ada): the handle changed while it was read",
    );
    expect(await snapshots(db)).toContainEqual(["Ada Lovelace", null]);
  });

  test("stops reading at `until`; what is left waits, counted as remaining", async () => {
    const db = await seededDatabase();
    databases.push(db);
    const stuck = Layer.succeed(
      FollowerSource,
      FollowerSource.of({ read: () => Effect.never }),
    );
    // The real clock here: the read is cut off when the time runs out.
    const report = await Effect.runPromise(
      Effect.gen(function* () {
        const until = DateTime.addDuration(
          yield* DateTime.now,
          Duration.millis(50),
        );
        return yield* refreshFollowers({
          dryRun: false,
          maxProfiles: 10,
          staleAfter: "7 days",
          until,
        });
      }).pipe(Effect.provide(Layer.merge(stuck, sqlLayer(db)))),
    );
    expect(report).toEqual({ refreshed: [], failed: [], remaining: 3 });
    expect(await snapshots(db)).toEqual([
      ["Ada Lovelace", null],
      ["Future Speaker", null],
      ["Linus", null],
    ]);
  });

  test("a dry run reads and reports, and writes nothing", async () => {
    const db = await seededDatabase();
    databases.push(db);
    const report = await refresh(db, { ada: 5 }, { dryRun: true });
    expect(report.refreshed).toEqual(["Ada Lovelace (@ada): ∅ → 5"]);
    expect(await snapshots(db)).toEqual([
      ["Ada Lovelace", null],
      ["Future Speaker", null],
      ["Linus", null],
    ]);
  });
});
