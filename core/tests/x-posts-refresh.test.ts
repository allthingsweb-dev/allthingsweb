import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { PeopleFile } from "../src/people-enrichment.ts";
import {
  duePosts,
  findCandidates,
  refreshPosts,
} from "../src/x-posts-refresh.ts";
import {
  type ReadPost,
  unescapeText,
  XPostsSource,
  XReadError,
} from "../src/x-posts-source.ts";

/** Finding and refreshing X posts against a fixed source: nothing here reaches X. */

const read = (
  id: string,
  createdAt: string,
  counts: Partial<ReadPost> = {},
): ReadPost => ({
  id,
  handle: "Ada_L",
  createdAt,
  text: `Post ${id}: the engine weaves algebraic patterns https://t.co/x`,
  likes: 10,
  reposts: 1,
  replies: 1,
  quotes: 0,
  ...counts,
});

const timeline = [
  read("1", "2026-10-01T10:00:00.000Z", { likes: 5 }),
  read("2", "2026-09-20T10:00:00.000Z", { likes: 900, reposts: 50 }),
  read("3", "2026-09-10T10:00:00.000Z", { text: "https://t.co/only-a-link" }),
  read("4", "2026-08-01T10:00:00.000Z", { likes: 100 }),
];

const asked: Array<string> = [];
const source = (served: ReadonlyMap<string, ReadPost | null>) =>
  Layer.succeed(
    XPostsSource,
    XPostsSource.of({
      account: (handle) =>
        handle === "gone"
          ? Effect.fail(
              new XReadError({
                what: handle,
                reason: "X answered 404",
                retryable: false,
              }),
            )
          : Effect.succeed({ id: "42", handle }),
      ownPosts: (userId, since) => {
        asked.push(`${userId} since ${since}`);
        return Effect.succeed(
          timeline.filter((post) => post.createdAt >= since),
        );
      },
      posts: (ids) =>
        Effect.succeed(
          new Map(
            ids.flatMap((id) =>
              served.has(id) ? [[id, served.get(id)!] as const] : [],
            ),
          ),
        ),
    }),
  );

describe("findCandidates", () => {
  test("ranks a person's own posts of the window by how they were taken up, leaving out posts with no words", async () => {
    asked.length = 0;
    const [ada, gone] = await Effect.runPromise(
      findCandidates(
        [
          { profileId: "a", name: "Ada", handle: "ada_l", userId: null },
          { profileId: "g", name: "Gone", handle: "gone", userId: null },
        ],
        { today: "2026-10-03", days: 90, top: 2, read: 100 },
      ).pipe(Effect.provide(source(new Map()))),
    );
    expect(asked).toEqual(["42 since 2026-07-05T00:00:00.000Z"]);
    expect(ada!.candidates.map((candidate) => candidate.post)).toEqual([
      {
        url: "https://x.com/Ada_L/status/2",
        postedOn: "2026-09-20",
        excerpt: "Post 2: the engine weaves algebraic patterns",
        likes: 900,
        reposts: 50,
        replies: 1,
      },
      expect.objectContaining({ url: "https://x.com/Ada_L/status/4" }),
    ]);
    expect(gone).toEqual({
      profileId: "g",
      name: "Gone",
      handle: "gone",
      candidates: [],
      failed: "X answered 404",
    });
  });
});

describe("refreshPosts", () => {
  const post = (id: string, postedOn: string) => ({
    url: `https://x.com/Ada_L/status/${id}`,
    postedOn,
    excerpt: "The engine weaves algebraic patterns.",
    likes: 1,
    reposts: 1,
    replies: 1,
  });
  const file: PeopleFile = [
    {
      profileId: "a",
      name: "Ada",
      xPosts: {
        posts: [
          post("2", "2026-09-20"),
          post("1", "2026-09-10"),
          post("9", "2026-09-01"),
        ],
        readOn: "2026-09-21",
      },
    },
    {
      profileId: "g",
      name: "Grace",
      xPosts: { posts: [post("5", "2026-09-01")], readOn: "2026-09-02" },
    },
    { profileId: "l", name: "Linus" },
  ];
  const run = (served: ReadonlyMap<string, ReadPost | null>, days = 0) =>
    Effect.runPromise(
      refreshPosts(file, "2026-10-03", days).pipe(
        Effect.provide(source(served)),
      ),
    );

  test("reads every post's counts again, drops one X no longer serves, keeps one it didn't answer for (and the day it was read), and takes a record left empty down", async () => {
    const { file: after, lines } = await run(
      new Map([
        [
          "2",
          read("2", "2026-09-20T10:00:00.000Z", {
            likes: 7,
            reposts: 2,
            replies: 3,
          }),
        ],
        ["1", null],
        ["5", null],
      ]),
    );
    expect(after[0]!.xPosts).toEqual({
      posts: [
        { ...post("2", "2026-09-20"), likes: 7, reposts: 2, replies: 3 },
        post("9", "2026-09-01"),
      ],
      readOn: "2026-09-21",
    });
    expect(after[1]!.xPosts).toBeNull();
    expect(after[2]).toEqual(file[2]);
    expect(lines).toEqual([
      "Ada: https://x.com/Ada_L/status/2 1/1/1 → 7/2/3 (likes/reposts/replies)",
      "Ada: dropped https://x.com/Ada_L/status/1, which X no longer serves",
      "Ada: https://x.com/Ada_L/status/9 wasn't read; its counts stay as read on 2026-09-21",
      "Grace: dropped https://x.com/Ada_L/status/5, which X no longer serves",
      "Read 4 posts of 2 people again.",
    ]);
  });

  test("dates the record today once every post was read", async () => {
    const all = new Map(
      ["2", "1", "9", "5"].map(
        (id) => [id, read(id, "2026-09-01T10:00:00.000Z")] as const,
      ),
    );
    const { file: after } = await run(all);
    expect(after[0]!.xPosts?.readOn).toBe("2026-10-03");
    expect(after[1]!.xPosts?.readOn).toBe("2026-10-03");
  });

  test("with days, reads only the records read that long ago", async () => {
    const { file: after } = await run(new Map([["5", null]]), 20);
    expect(after[0]).toEqual(file[0]);
    expect(after[1]!.xPosts).toBeNull();
  });
});

describe("unescapeText", () => {
  test("gives back the words X's API escaped", () => {
    expect(unescapeText("human &lt;&gt; agent &amp;amp; more")).toBe(
      "human <> agent &amp; more",
    );
  });
});

describe("duePosts", () => {
  test("lists the records read `days` or more days ago, oldest first", () => {
    const file: PeopleFile = [
      {
        profileId: "a",
        name: "Ada",
        xPosts: {
          posts: [
            {
              url: "https://x.com/a/status/1",
              postedOn: "2026-09-01",
              excerpt: "Hi there.",
              likes: 0,
              reposts: 0,
              replies: 0,
            },
          ],
          readOn: "2026-09-02",
        },
      },
      {
        profileId: "b",
        name: "Bea",
        xPosts: {
          posts: [
            {
              url: "https://x.com/b/status/1",
              postedOn: "2026-08-01",
              excerpt: "Hi there.",
              likes: 0,
              reposts: 0,
              replies: 0,
            },
          ],
          readOn: "2026-08-02",
        },
      },
      {
        profileId: "c",
        name: "Cy",
        xPosts: {
          posts: [
            {
              url: "https://x.com/c/status/1",
              postedOn: "2026-10-01",
              excerpt: "Hi there.",
              likes: 0,
              reposts: 0,
              replies: 0,
            },
          ],
          readOn: "2026-10-02",
        },
      },
    ];
    expect(duePosts(file, "2026-10-03", 30)).toEqual([
      { profileId: "b", name: "Bea", readOn: "2026-08-02" },
      { profileId: "a", name: "Ada", readOn: "2026-09-02" },
    ]);
  });
});
