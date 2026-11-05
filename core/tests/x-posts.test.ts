import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  canonicalXPosts,
  countLabel,
  engagement,
  excerptOf,
  isDue,
  maxExcerpt,
  statusOf,
  XPosts,
} from "../src/x-posts.ts";

const post = (id: string, postedOn: string) => ({
  url: `https://x.com/ada/status/${id}`,
  postedOn,
  excerpt: "The engine weaves algebraic patterns.",
  likes: 1200,
  reposts: 80,
  replies: 12,
});
const record = {
  posts: [post("2", "2026-10-01"), post("1", "2026-09-30")],
  readOn: "2026-10-02",
};
const decodes = (value: unknown) =>
  Schema.decodeUnknownExit(XPosts, { onExcessProperty: "error" })(value)
    ._tag === "Success";

describe("XPosts", () => {
  test("takes up to three of one handle's posts, latest first, read after they were posted", () => {
    expect(decodes(record)).toBe(true);
    expect(
      decodes({
        ...record,
        posts: [...record.posts, post("0", "2026-09-30")],
      }),
    ).toBe(true);
  });

  test("refuses none, more than three, a post twice, posts out of order, or one posted after they were read", () => {
    expect(decodes({ ...record, posts: [] })).toBe(false);
    expect(
      decodes({
        ...record,
        posts: [
          post("4", "2026-10-01"),
          post("3", "2026-10-01"),
          post("2", "2026-10-01"),
          post("1", "2026-10-01"),
        ],
      }),
    ).toBe(false);
    expect(
      decodes({
        ...record,
        posts: [post("1", "2026-10-01"), post("1", "2026-10-01")],
      }),
    ).toBe(false);
    expect(decodes({ ...record, posts: record.posts.toReversed() })).toBe(
      false,
    );
    expect(decodes({ ...record, readOn: "2026-09-30" })).toBe(false);
  });

  test("refuses another address, a long or padded quote, a negative count, a day that isn't one, and an unknown key", () => {
    const one = (change: object) =>
      decodes({
        ...record,
        posts: [{ ...post("1", "2026-10-01"), ...change }],
      });
    expect(one({ url: "https://twitter.com/ada/status/1" })).toBe(false);
    expect(one({ url: "https://x.com/ada/status/1?s=20" })).toBe(false);
    expect(one({ url: "http://x.com/ada/status/1" })).toBe(false);
    expect(one({ excerpt: "x".repeat(maxExcerpt + 1) })).toBe(false);
    expect(one({ excerpt: " padded" })).toBe(false);
    expect(one({ excerpt: "two\nlines" })).toBe(false);
    expect(one({ likes: -1 })).toBe(false);
    expect(one({ likes: 1.5 })).toBe(false);
    expect(one({ postedOn: "2026-02-30" })).toBe(false);
    expect(one({ views: 10 })).toBe(false);
    expect(decodes({ ...record, readOn: "2026-10" })).toBe(false);
  });

  test("is stored with its keys in one order", () => {
    const shuffled = {
      readOn: record.readOn,
      posts: record.posts.map(({ replies, url, ...rest }) => ({
        replies,
        ...rest,
        url,
      })),
    };
    expect(canonicalXPosts(shuffled)).toBe(canonicalXPosts(record));
    expect(Object.keys(JSON.parse(canonicalXPosts(shuffled)))).toEqual([
      "posts",
      "readOn",
    ]);
  });
});

describe("statusOf", () => {
  test("reads the handle and id of a post's address, and nothing else", () => {
    expect(statusOf("https://x.com/Ada_L/status/123")).toEqual({
      handle: "Ada_L",
      id: "123",
    });
    expect(statusOf("https://x.com/ada")).toBeUndefined();
    expect(statusOf("https://x.com/ada/status/123/photo/1")).toBeUndefined();
  });
});

describe("excerptOf", () => {
  test("takes out links and line breaks, and keeps a short post whole", () => {
    expect(
      excerptOf("Shipped it.\n\nRead more: https://t.co/abc123 today"),
    ).toBe("Shipped it. Read more: today");
  });

  test("cuts a long post at a word, with an ellipsis", () => {
    const long = `${"word ".repeat(40)}end`;
    const cut = excerptOf(long);
    expect(cut.length).toBeLessThanOrEqual(maxExcerpt);
    expect(cut.endsWith("word…")).toBe(true);
  });
});

describe("engagement", () => {
  test("weighs reposts and quotes twice a like, and leaves replies out", () => {
    expect(engagement({ likes: 10, replies: 200, reposts: 3, quotes: 1 })).toBe(
      18,
    );
  });
});

describe("countLabel", () => {
  test("says a count the way the page does", () => {
    expect(
      [0, 980, 1000, 4711, 12_400, 999_999, 1_234_567].map(countLabel),
    ).toEqual(["0", "980", "1k", "4.7k", "12k", "999k", "1.2m"]);
  });
});

describe("isDue", () => {
  test("is due once `days` have passed since they were read", () => {
    expect(isDue("2026-10-01", "2026-10-31", 30)).toBe(true);
    expect(isDue("2026-10-02", "2026-10-31", 30)).toBe(false);
  });
});
