import { Effect } from "effect";
import type { PeopleFile } from "./people-enrichment.ts";
import {
  engagement,
  excerptOf,
  isDue,
  statusOf,
  type XPost,
  type XPosts,
} from "./x-posts.ts";
import { type ReadPost, XPostsSource } from "./x-posts-source.ts";

/**
 * Finding and refreshing people's standout posts on X (src/x-posts.ts),
 * for `bun run people posts`. Finding lists each person's own recent posts
 * ranked by how they were taken up, for an agent to pick the ones that
 * stand out for building software and write them into
 * core/backfill/people.json; it writes nothing, since relevance is a
 * judgment. Refreshing reads the counts of every post the file holds
 * again, and drops a post X no longer serves.
 */

/** Someone to find posts for: their profile, X handle and, once known, X user id. */
export interface Poster {
  readonly profileId: string;
  readonly name: string;
  readonly handle: string;
  readonly userId: string | null;
}

/** A post worth a look, ranked: what the file would hold, its whole text, and its score. */
export interface Candidate {
  readonly post: XPost;
  readonly text: string;
  readonly quotes: number;
  readonly score: number;
}

export interface Candidates {
  readonly profileId: string;
  readonly name: string;
  readonly handle: string;
  readonly candidates: ReadonlyArray<Candidate>;
  /** Why none could be read, where none could. */
  readonly failed?: string;
}

/** `post` as the file holds it: its address under `handle`, its day, a short quote and its counts. */
export const toXPost = (post: ReadPost, handle: string): XPost => ({
  url: `https://x.com/${post.handle ?? handle}/status/${post.id}`,
  postedOn: post.createdAt.slice(0, 10),
  excerpt: excerptOf(post.text),
  likes: post.likes,
  reposts: post.reposts,
  replies: post.replies,
});

/** A post with words of its own to quote: not only a link or a picture. */
const hasWords = (post: ReadPost) => excerptOf(post.text).length >= 12;

/**
 * Each poster's own posts of the last `days` days before `today`
 * (YYYY-MM-DD), at most `read` read, ranked by {@link engagement}, the top
 * `top` of them.
 */
export const findCandidates = (
  posters: ReadonlyArray<Poster>,
  options: {
    readonly today: string;
    readonly days: number;
    readonly top: number;
    readonly read: number;
  },
) =>
  Effect.gen(function* () {
    const source = yield* XPostsSource;
    const since = new Date(
      Date.parse(`${options.today}T00:00:00Z`) - options.days * 86_400_000,
    ).toISOString();
    const found: Array<Candidates> = [];
    for (const poster of posters) {
      const read = yield* Effect.gen(function* () {
        const userId =
          poster.userId ?? (yield* source.account(poster.handle)).id;
        return yield* source.ownPosts(userId, since, options.read);
      }).pipe(Effect.result);
      if (read._tag === "Failure") {
        found.push({
          profileId: poster.profileId,
          name: poster.name,
          handle: poster.handle,
          candidates: [],
          failed: read.failure.reason,
        });
        continue;
      }
      const candidates = read.success
        .filter(hasWords)
        .map((post) => ({
          post: toXPost(post, poster.handle),
          text: post.text,
          quotes: post.quotes,
          score: engagement(post),
        }))
        .toSorted((a, b) => b.score - a.score)
        .slice(0, options.top);
      found.push({
        profileId: poster.profileId,
        name: poster.name,
        handle: poster.handle,
        candidates,
      });
    }
    return found;
  });

/** What a refresh did to one person's posts. */
export interface Refreshed {
  readonly file: PeopleFile;
  readonly lines: ReadonlyArray<string>;
}

/**
 * The file with every post's counts read again on `today`, and each post
 * X no longer serves dropped; a record left with none becomes `null`, so
 * applying it takes the section down. Only records read `days` or more
 * days before `today` are read again (0: all of them).
 */
export const refreshPosts = (file: PeopleFile, today: string, days: number) =>
  Effect.gen(function* () {
    const source = yield* XPostsSource;
    const due = file.filter(
      (entry) =>
        entry.xPosts != null && isDue(entry.xPosts.readOn, today, days),
    );
    const ids = due.flatMap((entry) =>
      entry.xPosts!.posts.map((post) => statusOf(post.url)!.id),
    );
    const read =
      ids.length === 0
        ? new Map<string, ReadPost | null>()
        : yield* source.posts(ids);
    const lines: Array<string> = [];
    const refreshed = file.map((entry) => {
      if (!due.includes(entry)) return entry;
      const kept: Array<XPost> = [];
      // A post X didn't answer for keeps its old counts, so the record
      // keeps the day they were read.
      let unread = false;
      for (const post of entry.xPosts!.posts) {
        const now = read.get(statusOf(post.url)!.id);
        if (now === null) {
          lines.push(
            `${entry.name}: dropped ${post.url}, which X no longer serves`,
          );
          continue;
        }
        if (now === undefined) {
          lines.push(
            `${entry.name}: ${post.url} wasn't read; its counts stay as read on ${entry.xPosts!.readOn}`,
          );
          kept.push(post);
          unread = true;
          continue;
        }
        if (
          now.likes !== post.likes ||
          now.reposts !== post.reposts ||
          now.replies !== post.replies
        ) {
          lines.push(
            `${entry.name}: ${post.url} ${post.likes}/${post.reposts}/${post.replies} → ${now.likes}/${now.reposts}/${now.replies} (likes/reposts/replies)`,
          );
        }
        kept.push({
          ...post,
          likes: now.likes,
          reposts: now.reposts,
          replies: now.replies,
        });
      }
      const xPosts: XPosts | null =
        kept.length === 0
          ? null
          : { posts: kept, readOn: unread ? entry.xPosts!.readOn : today };
      return { ...entry, xPosts };
    });
    lines.push(`Read ${ids.length} posts of ${due.length} people again.`);
    return { file: refreshed, lines } satisfies Refreshed;
  });

/** Records read `days` or more days before `today`, oldest first: due for `posts --refresh`. */
export const duePosts = (file: PeopleFile, today: string, days: number) =>
  file
    .flatMap((entry) =>
      entry.xPosts == null || !isDue(entry.xPosts.readOn, today, days)
        ? []
        : [
            {
              profileId: entry.profileId,
              name: entry.name,
              readOn: entry.xPosts.readOn,
            },
          ],
    )
    .toSorted(
      (a, b) =>
        a.readOn.localeCompare(b.readOn) || a.name.localeCompare(b.name),
    );
