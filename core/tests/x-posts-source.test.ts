import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigProvider, Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { XPostsSource } from "../src/x-posts-source.ts";

/** X's API as the source reads it, against a fake X: its day cache. Nothing here reaches X. */

const directories: Array<string> = [];
afterAll(() =>
  Promise.all(
    directories.map((dir) => rm(dir, { recursive: true, force: true })),
  ),
);

const answer = {
  data: [
    {
      id: "1",
      text: "human &lt;&gt; agent",
      created_at: "2026-10-01T10:00:00.000Z",
      author_id: "42",
      public_metrics: {
        like_count: 5,
        retweet_count: 1,
        reply_count: 0,
        quote_count: 0,
      },
    },
  ],
  includes: { users: [{ id: "42", username: "Ada_L" }] },
};

const withX = (
  directory: string,
  asked: Array<string>,
  readOnly = false,
  pages: Array<URL> = [],
) =>
  XPostsSource.xApi({ directory, day: "2026-10-03", readOnly }).pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request, url) =>
          Effect.sync(() => {
            asked.push(url.pathname);
            pages.push(url);
            return HttpClientResponse.fromWeb(
              request,
              new Response(JSON.stringify(answer), {
                headers: { "content-type": "application/json" },
              }),
            );
          }),
        ),
      ),
    ),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({ X_BEARER_TOKEN: "test" }),
      ),
    ),
  );

const read = (directory: string, asked: Array<string>, readOnly = false) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const source = yield* XPostsSource;
      return yield* source.posts(["1"]);
    }).pipe(Effect.provide(withX(directory, asked, readOnly))),
  );

describe("XPostsSource.xApi", () => {
  test("keeps an answer for its day, written whole, gives the post's words back unescaped, and reads X again for an entry it can't read", async () => {
    const directory = await mkdtemp(join(tmpdir(), "x-cache-"));
    directories.push(directory);
    const asked: Array<string> = [];
    const first = await read(directory, asked);
    expect(first.get("1")).toEqual({
      id: "1",
      handle: "Ada_L",
      createdAt: "2026-10-01T10:00:00.000Z",
      text: "human <> agent",
      likes: 5,
      reposts: 1,
      replies: 0,
      quotes: 0,
    });
    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^2026-10-03-[0-9a-f]{64}\.json$/);
    await read(directory, asked);
    expect(asked).toEqual(["/2/tweets"]);
    await Bun.write(join(directory, files[0]!), "{ half an ans");
    await read(directory, asked);
    expect(asked).toEqual(["/2/tweets", "/2/tweets"]);
    expect(await readdir(directory)).toEqual(files);
  });

  test("uses X's answer all the same when it can't keep it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "x-cache-"));
    directories.push(directory);
    // A file where the cache's directory should be: nothing can be kept there.
    const blocked = join(directory, "not-a-directory");
    await Bun.write(blocked, "");
    const asked: Array<string> = [];
    const posts = await read(blocked, asked);
    expect(posts.get("1")?.text).toBe("human <> agent");
    expect(await readdir(directory)).toEqual(["not-a-directory"]);
  });

  test("reads X again for a kept entry that isn't an answer, and a dry run keeps nothing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "x-cache-"));
    directories.push(directory);
    const asked: Array<string> = [];
    await read(directory, asked, true);
    expect(await readdir(directory)).toEqual([]);
    await read(directory, asked);
    const [entry] = await readdir(directory);
    await Bun.write(
      join(directory, entry!),
      JSON.stringify({ data: "not posts" }),
    );
    await read(directory, asked);
    expect(asked).toEqual(["/2/tweets", "/2/tweets", "/2/tweets"]);
  });

  test("never asks X for more of someone's posts than it may read", async () => {
    const directory = await mkdtemp(join(tmpdir(), "x-cache-"));
    directories.push(directory);
    const pages: Array<URL> = [];
    await Effect.runPromise(
      Effect.gen(function* () {
        const source = yield* XPostsSource;
        return yield* source.ownPosts("42", "2026-07-05T00:00:00.000Z", 7);
      }).pipe(Effect.provide(withX(directory, [], true, pages))),
    );
    expect(pages.map((url) => url.searchParams.get("max_results"))).toEqual([
      "7",
    ]);
  });
});
