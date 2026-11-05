import { Schema } from "effect";

/**
 * A person's standout recent posts on X (core's README, "Their posts on
 * X"): up to three of their own posts, each a link with its day, a short
 * quote of its words and its public counts, all read on one day. It is
 * one of the people pipeline's facts (core/backfill/people.json,
 * src/people-enrichment.ts), stored whole in `profiles.x_posts`, so taking
 * it down is clearing one column.
 *
 * It sits beside "now" (src/now.ts) rather than in it: now is a sourced
 * line about what someone does, written by hand; these are picked from X
 * by how people took them, and their counts are read again by a command
 * (`bun run people posts --refresh`). A post is never in both.
 *
 * X's terms shape it: each post is linked, never embedded, and only a
 * short quote of it is kept; a post X no longer serves (deleted, or its
 * account made private) is dropped at the next refresh.
 */

/** A day on the calendar, YYYY-MM-DD: never a February 30th. */
const Day = Schema.String.check(
  Schema.makeFilter((value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      return `${value} is not a YYYY-MM-DD day`;
    const day = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(day.getTime()) &&
      day.toISOString().slice(0, 10) === value
      ? undefined
      : `${value} is not a day on the calendar`;
  }),
);

/** A post's own address: https://x.com/<handle>/status/<id>, nothing more. */
const statusUrl =
  /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/([0-9]{1,20})$/;

/** The handle and post id in a post's address, or undefined for any other URL. */
export const statusOf = (
  url: string,
): { readonly handle: string; readonly id: string } | undefined => {
  const match = statusUrl.exec(url);
  return match === null ? undefined : { handle: match[1]!, id: match[2]! };
};

/** The longest quote of a post kept, in characters. */
export const maxExcerpt = 140;

/** The most posts a person's record holds. */
export const maxPosts = 3;

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** One post: where it is, the day it was posted, a short quote, and its counts as read. */
export const XPost = Schema.Struct({
  url: Schema.String.check(
    Schema.makeFilter((url: string) =>
      statusOf(url) === undefined
        ? `${url} is not a post's address, https://x.com/<handle>/status/<id>`
        : undefined,
    ),
  ),
  /** The UTC day it was posted. */
  postedOn: Day,
  /** Their own words, a short quote on one line; "…" where it was cut. */
  excerpt: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(maxExcerpt),
    Schema.makeFilter((value: string) =>
      value.trim() === value && !/[\n\r\t]/.test(value)
        ? undefined
        : "expected one line with no surrounding space",
    ),
  ),
  likes: Count,
  reposts: Count,
  replies: Count,
});
export type XPost = typeof XPost.Type;

export const XPosts = Schema.Struct({
  /** Latest first, each post once, none posted after `readOn`. */
  posts: Schema.Array(XPost).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(maxPosts),
    Schema.makeFilter((posts: ReadonlyArray<XPost>) => {
      const ids = posts.map((post) => statusOf(post.url)?.id);
      if (new Set(ids).size !== ids.length) return "expected each post once";
      return posts.every(
        (post, index) =>
          index === 0 || posts[index - 1]!.postedOn >= post.postedOn,
      )
        ? undefined
        : "expected the posts latest first";
    }),
  ),
  /** The day the posts and their counts were read. */
  readOn: Day,
}).check(
  Schema.makeFilter(
    (record: { posts: ReadonlyArray<XPost>; readOn: string }) => {
      const late = record.posts.find((post) => post.postedOn > record.readOn);
      return late === undefined
        ? undefined
        : `${late.url} was posted on ${late.postedOn}, after the posts were read on ${record.readOn}`;
    },
  ),
);
export type XPosts = typeof XPosts.Type;

/** The record as stored and compared: its keys in one order. */
export const canonicalXPosts = (record: XPosts): string =>
  JSON.stringify({
    posts: record.posts.map((post) => ({
      url: post.url,
      postedOn: post.postedOn,
      excerpt: post.excerpt,
      likes: post.likes,
      reposts: post.reposts,
      replies: post.replies,
    })),
    readOn: record.readOn,
  });

/** A stored record, as `profiles.x_posts` holds it, or null where it holds none. */
export const decodeStoredXPosts = Schema.decodeUnknownEffect(
  Schema.NullOr(XPosts),
  { onExcessProperty: "error" },
);

/**
 * A short quote of a post's text: its links (X's t.co addresses) taken out,
 * its lines run together, and cut at a word before `max` characters with
 * "…" where anything was left out.
 */
export function excerptOf(text: string, max = maxExcerpt): string {
  const plain = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  // Never half of a character written as two code units (an emoji, say).
  const cut = plain.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, "");
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > max / 2 ? cut.slice(0, atWord) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/** Public counts as X gives them. */
export interface PostCounts {
  readonly likes: number;
  readonly reposts: number;
  readonly replies: number;
  readonly quotes: number;
}

/**
 * How much a post was taken up, for ranking a person's own posts against
 * each other: a repost or a quote carries it to new readers, so it counts
 * twice a like. Replies don't count: a giveaway or a call for feedback
 * draws them without standing out.
 */
export const engagement = (counts: PostCounts): number =>
  counts.likes + 2 * counts.reposts + 2 * counts.quotes;

/** A count as the page says it: 980, 4.7k, 12k, 1.2m. */
export function countLabel(count: number): string {
  const scaled = (n: number, unit: string) => {
    const rounded = n < 10 ? Math.floor(n * 10) / 10 : Math.floor(n);
    return `${String(rounded).replace(/\.0$/, "")}${unit}`;
  };
  if (count < 1000) return String(count);
  if (count < 1_000_000) return scaled(count / 1000, "k");
  return scaled(count / 1_000_000, "m");
}

/**
 * Whether posts read on `readOn` are due again on `today` (both
 * YYYY-MM-DD): read `days` or more days before.
 */
export const isDue = (readOn: string, today: string, days: number) =>
  (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${readOn}T00:00:00Z`)) /
    86_400_000 >=
  days;
