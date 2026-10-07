import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import {
  ConfigProvider,
  DateTime,
  Duration,
  Effect,
  Exit,
  Layer,
  Order,
} from "effect";
import { HttpClient, HttpClientResponse, UrlParams } from "effect/http";
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

const user = (screenName: string, followers: number, id = "81712767") =>
  JSON.stringify({
    code: 200,
    user: { id, screen_name: screenName, followers, name: screenName },
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
    expect(Exit.isSuccess(exit) ? exit.value : exit).toEqual({
      id: "81712767",
      handle: "Ada",
      followers: 1234,
    });
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

/** X's API, answering `users` by id from `known`; every request recorded. */
const fakeXApi = (
  known: Readonly<Record<string, { username: string; followers: number }>>,
) => {
  const requests: Array<{ path: string; ids: string | null }> = [];
  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      const url = new URL(request.url);
      const params = new URLSearchParams(UrlParams.toString(request.urlParams));
      const ids = params.get("ids");
      requests.push({ path: url.pathname, ids });
      const userOf = (id: string) => {
        const k = known[id];
        return k === undefined
          ? undefined
          : {
              id,
              username: k.username,
              public_metrics: { followers_count: k.followers },
            };
      };
      const body =
        url.pathname === "/2/users"
          ? {
              data: (ids ?? "").split(",").flatMap((id) => {
                const u = userOf(id);
                return u === undefined ? [] : [u];
              }),
              errors: (ids ?? "")
                .split(",")
                .filter((id) => userOf(id) === undefined)
                .map((id) => ({
                  value: id,
                  resource_id: id,
                  title: "Not Found Error",
                  detail: `Could not find user with ids: [${id}].`,
                })),
            }
          : (() => {
              const handle = url.pathname.split("/").at(-1) ?? "";
              const found = Object.entries(known).find(
                ([, k]) => k.username.toLowerCase() === handle.toLowerCase(),
              );
              return found === undefined ? {} : { data: userOf(found[0]) };
            })();
      return Effect.succeed(
        HttpClientResponse.fromWeb(request, Response.json(body)),
      );
    }),
  );
  return { layer, requests };
};

/** FollowerSource.xApi over `http`, with a bearer token. */
const xApiSource = (http: Layer.Layer<HttpClient.HttpClient>) =>
  FollowerSource.xApi.pipe(
    Layer.provide(http),
    Layer.provide(
      Layer.succeed(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({ env: { X_BEARER_TOKEN: "test" } }),
      ),
    ),
  );

describe("FollowerSource.xApi", () => {
  test("reads accounts by id, up to 100 a request, and says which X doesn't have", async () => {
    const x = fakeXApi({ "11": { username: "ada", followers: 120 } });
    const found = await Effect.runPromise(
      FollowerSource.use(
        (source) => source.readByIds?.(["11", "12"]) ?? Effect.die("no batch"),
      ).pipe(Effect.provide(xApiSource(x.layer))),
    );
    expect(found.get("11")).toEqual({
      id: "11",
      handle: "ada",
      followers: 120,
    });
    expect(found.get("12")).toBeInstanceOf(FollowerReadError);
    expect(x.requests).toEqual([{ path: "/2/users", ids: "11,12" }]);
  });
});

const databases: Array<PGlite> = [];
afterAll(() => Promise.all(databases.map((db) => db.close())));

/** Each seeded handle's X account id. */
const ids: Readonly<Record<string, string>> = {
  ada: "11",
  linus: "13",
  future: "15",
};

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
          : Effect.succeed({
              id: ids[handle] ?? "99",
              handle,
              followers: counts[handle],
            }),
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
              ).pipe(Effect.as({ id: "11", handle: "ada", followers: 120 }))
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
    expect(report).toEqual({
      refreshed: [],
      renamed: [],
      lost: [],
      failed: [],
      remaining: 3,
    });
    expect(await snapshots(db)).toEqual([
      ["Ada Lovelace", null],
      ["Future Speaker", null],
      ["Linus", null],
    ]);
  });

  test("handles that keep failing go behind the others, so they never block a count", async () => {
    const db = await seededDatabase();
    databases.push(db);
    // Only Future Speaker's count can be read; two slots a run.
    const first = await refresh(db, { future: 2 }, { maxProfiles: 2 });
    const second = await refresh(db, { future: 2 }, { maxProfiles: 2 });
    const tried = [
      ...first.failed,
      ...first.refreshed,
      ...second.failed,
      ...second.refreshed,
    ];
    // Between them the two runs ask about all three.
    expect(new Set(tried.map((line) => line.split(" (@")[0])).size).toBe(3);
    expect(await snapshots(db)).toContainEqual(["Future Speaker", 2]);
  });

  test("stores each account's id the first time, then knows the profile by it", async () => {
    const db = await seededDatabase();
    databases.push(db);
    await refresh(db, { ada: 120, linus: 9000, future: 3 });
    const { rows } = await db.query<{ name: string; x_user_id: string | null }>(
      `SELECT name, x_user_id FROM profiles WHERE twitter_handle IS NOT NULL ORDER BY name`,
    );
    expect(rows.map((row) => [row.name, row.x_user_id])).toEqual([
      ["Ada Lovelace", "11"],
      ["Future Speaker", "15"],
      ["Linus", "13"],
    ]);
  });

  test("never adopts a handle another account took: clears it, keeps the id, flags it", async () => {
    const db = await seededDatabase();
    databases.push(db);
    await refresh(db, { ada: 120 });
    // A week and more on: Ada's count is due again.
    await db.exec(
      `UPDATE profiles SET x_followers_at = x_followers_at - interval '30 days', x_followers_tried_at = x_followers_tried_at - interval '30 days' WHERE name = 'Ada Lovelace'`,
    );
    // Someone else has @ada now.
    const taken = Layer.succeed(
      FollowerSource,
      FollowerSource.of({
        read: (handle) => Effect.succeed({ id: "77", handle, followers: 5 }),
      }),
    );
    const report = await Effect.runPromise(
      refreshFollowers({
        dryRun: false,
        maxProfiles: 10,
        staleAfter: "7 days",
      }).pipe(Effect.provide(Layer.mergeAll(taken, sqlLayer(db), clockLayer))),
    );
    expect(report.lost).toContain(
      "Ada Lovelace: @ada is now another X account's (77, not 11); cleared",
    );
    const { rows } = await db.query(
      `SELECT twitter_handle, x_user_id, x_followers, x_handle_lost, x_handle_lost_at IS NOT NULL AS flagged
       FROM profiles WHERE name = 'Ada Lovelace'`,
    );
    expect(rows).toEqual([
      {
        twitter_handle: null,
        x_user_id: "11",
        x_followers: null,
        x_handle_lost: "ada",
        flagged: true,
      },
    ]);
  });

  test("finds a renamed account by its id and stores its new handle", async () => {
    const db = await seededDatabase();
    databases.push(db);
    await refresh(db, { ada: 120 });
    // A week and more on: Ada's count is due again.
    await db.exec(
      `UPDATE profiles SET x_followers_at = x_followers_at - interval '30 days', x_followers_tried_at = x_followers_tried_at - interval '30 days' WHERE name = 'Ada Lovelace'`,
    );
    const byId = Layer.succeed(
      FollowerSource,
      FollowerSource.of({
        read: (handle) =>
          Effect.fail(
            new FollowerReadError({
              handle,
              reason: "unknown",
              retryable: false,
            }),
          ),
        readById: (id) =>
          Effect.succeed({
            id,
            handle: id === "11" ? "ada_renamed" : "x",
            followers: 130,
          }),
      }),
    );
    const report = await Effect.runPromise(
      refreshFollowers({
        dryRun: false,
        maxProfiles: 1,
        staleAfter: "7 days",
      }).pipe(Effect.provide(Layer.mergeAll(byId, sqlLayer(db), clockLayer))),
    );
    expect(report.renamed).toEqual(["Ada Lovelace: @ada → @ada_renamed"]);
    const { rows } = await db.query(
      `SELECT twitter_handle, x_user_id, x_followers FROM profiles WHERE name = 'Ada Lovelace'`,
    );
    expect(rows).toEqual([
      { twitter_handle: "ada_renamed", x_user_id: "11", x_followers: 130 },
    ]);
  });

  test("a handle edited by hand forgets the old account: its id and a lost handle too", async () => {
    const db = await seededDatabase();
    databases.push(db);
    await refresh(db, { ada: 120 });
    await db.exec(
      `UPDATE profiles SET x_handle_lost = 'old', x_handle_lost_at = now() WHERE name = 'Ada Lovelace'`,
    );
    await db.exec(
      `UPDATE profiles SET twitter_handle = 'ada_real' WHERE name = 'Ada Lovelace'`,
    );
    const { rows } = await db.query(
      `SELECT x_user_id, x_followers, x_handle_lost FROM profiles WHERE name = 'Ada Lovelace'`,
    );
    expect(rows).toEqual([
      { x_user_id: null, x_followers: null, x_handle_lost: null },
    ]);
  });

  test("two profiles can't both have one X account", async () => {
    const db = await seededDatabase();
    databases.push(db);
    // Linus's handle answers with Ada's account.
    const shared = Layer.succeed(
      FollowerSource,
      FollowerSource.of({
        read: (handle) => Effect.succeed({ id: "11", handle, followers: 1 }),
      }),
    );
    const report = await Effect.runPromise(
      refreshFollowers({
        dryRun: false,
        maxProfiles: 10,
        staleAfter: "7 days",
      }).pipe(Effect.provide(Layer.mergeAll(shared, sqlLayer(db), clockLayer))),
    );
    expect(report.refreshed).toHaveLength(1);
    expect(
      report.failed.filter((line) => line.includes("has this X account (11)")),
    ).toHaveLength(2);
  });

  test("with X's API, reads every known id in one request and finds a renamed account", async () => {
    const db = await seededDatabase();
    databases.push(db);
    await refresh(db, { ada: 120, linus: 9000, future: 3 });
    await db.exec(
      `UPDATE profiles SET x_followers_at = x_followers_at - interval '30 days' WHERE twitter_handle IS NOT NULL`,
    );
    // Ada renamed her account; her id is the same.
    const x = fakeXApi({
      "11": { username: "ada_renamed", followers: 130 },
      "13": { username: "linus", followers: 9100 },
      "15": { username: "future", followers: 4 },
    });
    const report = await Effect.runPromise(
      refreshFollowers({
        dryRun: false,
        maxProfiles: 10,
        staleAfter: "7 days",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(xApiSource(x.layer), sqlLayer(db), clockLayer),
        ),
      ),
    );
    expect(x.requests).toEqual([
      { path: "/2/users", ids: expect.stringMatching(/^(1[135],){2}1[135]$/) },
    ]);
    expect(report.renamed).toEqual(["Ada Lovelace: @ada → @ada_renamed"]);
    expect(report.failed).toEqual([]);
    expect(await snapshots(db)).toEqual([
      ["Ada Lovelace", 130],
      ["Future Speaker", 4],
      ["Linus", 9100],
    ]);
  });

  test("a batch X refuses fails its profiles until a later run, never one request each", async () => {
    const db = await seededDatabase();
    databases.push(db);
    await refresh(db, { ada: 120, linus: 9000, future: 3 });
    await db.exec(
      `UPDATE profiles SET x_followers_at = x_followers_at - interval '30 days' WHERE twitter_handle IS NOT NULL`,
    );
    const paths: Array<string> = [];
    const refusing = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) => {
        paths.push(new URL(request.url).pathname);
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response("", { status: 503 }),
          ),
        );
      }),
    );
    const report = await Effect.runPromise(
      refreshFollowers({
        dryRun: false,
        maxProfiles: 10,
        staleAfter: "7 days",
      }).pipe(
        Effect.provide(
          // The real clock: the retries wait a second or two.
          Layer.mergeAll(xApiSource(refusing), sqlLayer(db)),
        ),
      ),
    );
    // The batch, tried three times (503s retry); no lookup per id.
    expect(paths.every((path) => path === "/2/users")).toBe(true);
    expect(report.failed).toHaveLength(3);
    expect(report.refreshed).toEqual([]);
  }, 15_000);

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
