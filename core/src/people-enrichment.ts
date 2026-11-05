import { DateTime, Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { asOf } from "./clock.ts";
import { HttpUrl } from "./contract.ts";
import { DataSourceError } from "./errors.ts";
import { xHandleOf } from "./followers.ts";
import { canonicalNow, decodeStoredNow, Now } from "./now.ts";
import {
  canonicalXPosts,
  decodeStoredXPosts,
  statusOf,
  XPosts,
} from "./x-posts.ts";

/**
 * What profiles lack, filled from public sources (core/backfill/people.json):
 * titles, bios, links and photos for people on published events, each fact
 * with the URL it was read from and the day it was read. Written in one
 * transaction, and only where the profile has nothing yet: a filled column
 * is kept, whatever the file says, unless the fact names the exact stale
 * value it replaces (`was`) and the column still holds just that. A
 * profile's photo source is never replaced once its image is copied. A
 * fact that could not be
 * confirmed (a same-name collision, a bio that isn't the person's own
 * words) is kept under `held` with its reason and never written.
 *
 * `now` is what they do now (src/now.ts, docs/now.md): a whole record,
 * which only this file writes, so it is written whenever it differs from
 * what is stored. `null` clears it and keeps it off; an entry without
 * `now` leaves it as it is.
 *
 * `xPosts` are their standout recent posts on X (src/x-posts.ts), written
 * the same way: whenever they differ from what is stored, `null` clearing
 * them. Every post must be by the profile's X handle (as stored, or as this
 * file sets it), and none may also be shown by their `now`.
 *
 * A title is the person's job title now, as of the day it was read, so
 * their page and its card say what they do today; their talks already say
 * when they spoke. Where no source gives a current one, it is their latest
 * known title (Erik, 2026-11-05, replacing "at the time of their evening"
 * from 2026-10-06).
 *
 * A bio is the person's own words, lightly trimmed or put in the third
 * person, or one an organizer asked for (`askedBy`): written in the
 * site's voice from the pages its fact lists, every claim on one of them.
 *
 * Photos go only into `photo_source_url`, and only from hosts the app's
 * hourly ingestion copies from (app/src/lib/profile-photos/hosts.ts), which
 * then sets the profile's image. A dry run does everything, reports it,
 * and rolls back.
 */

/** An https URL with a domain-name host, as the public contract accepts, and no whitespace. */
const Url = HttpUrl.check(Schema.isPattern(/^https:\/\/\S+$/));

/** The day a fact was read, YYYY-MM-DD. */
const Day = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));

/**
 * An organizer's instruction a fact was written on: who asked, the day, and
 * their words. A bio an organizer asked for as a best attempt, before the
 * person could give their own, says so here, beside the pages it drew on.
 */
const AskedBy = Schema.Struct({
  who: Schema.String.check(Schema.isNonEmpty()),
  on: Day,
  said: Schema.String.check(Schema.isNonEmpty()),
});

/**
 * A value, where it was read, and when. `was` names the one stale value it
 * may replace: a filled column is replaced only while it still holds
 * exactly that, so an edit made since is never lost. `also` lists the
 * other pages a value drew on, when no one page holds all of it, and
 * `askedBy` the organizer's instruction it was written on.
 */
const fact = <S extends Schema.Top>(value: S) =>
  Schema.Struct({
    value,
    source: Url,
    read: Day,
    was: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
    also: Schema.optionalKey(Schema.Array(Url).check(Schema.isMinLength(1))),
    askedBy: Schema.optionalKey(AskedBy),
  });

/**
 * Hosts profile photos may come from: the app's ingestion list
 * (app/src/lib/profile-photos/hosts.ts), which a test keeps this equal to.
 */
export const photoHosts: ReadonlySet<string> = new Set([
  "avatars.githubusercontent.com",
  "pbs.twimg.com",
  "bookface-images.s3.amazonaws.com",
  "images.lumacdn.com",
  "media.licdn.com",
]);

const PhotoUrl = Url.check(
  Schema.makeFilter((value: string) =>
    photoHosts.has(new URL(value).hostname)
      ? undefined
      : `expected a photo on ${[...photoHosts].join(", ")}`,
  ),
);

const Text = (max: number) =>
  Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(max),
    Schema.makeFilter((value: string) =>
      value.trim() === value ? undefined : "expected no surrounding space",
    ),
  );

export const fields = [
  "title",
  "bio",
  "twitterHandle",
  "blueskyHandle",
  "linkedinHandle",
  "photoSourceUrl",
] as const;
export type Field = (typeof fields)[number];

const columns: Readonly<Record<Field, string>> = {
  title: "title",
  bio: "bio",
  twitterHandle: "twitter_handle",
  blueskyHandle: "bluesky_handle",
  linkedinHandle: "linkedin_handle",
  photoSourceUrl: "photo_source_url",
};

export const PeopleEntry = Schema.Struct({
  /** The profile's id, and its name as stored, which must still match. */
  profileId: Schema.String.check(
    Schema.isPattern(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    ),
  ),
  name: Schema.String.check(Schema.isNonEmpty()),
  /** Their job title now, as of `read`, else their latest known one. */
  title: Schema.optionalKey(fact(Text(120))),
  /** Their own words, lightly trimmed or put in the third person, or written as an organizer asked (`askedBy`). */
  bio: Schema.optionalKey(fact(Text(2000))),
  twitterHandle: Schema.optionalKey(
    fact(Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_]{1,15}$/))),
  ),
  blueskyHandle: Schema.optionalKey(
    fact(
      Schema.String.check(
        Schema.isPattern(/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
      ),
    ),
  ),
  linkedinHandle: Schema.optionalKey(
    fact(Schema.String.check(Schema.isPattern(/^[A-Za-z0-9-]{3,100}$/))),
  ),
  photoSourceUrl: Schema.optionalKey(fact(PhotoUrl)),
  /**
   * What they do now, with every fact's source (src/now.ts). `null`: taken
   * down, and kept off (they asked, or it was wrong).
   */
  now: Schema.optionalKey(Schema.NullOr(Now)),
  /**
   * Their standout recent posts on X, with their counts as read
   * (src/x-posts.ts). `null`: taken down, and kept off.
   */
  xPosts: Schema.optionalKey(Schema.NullOr(XPosts)),
  /**
   * Facts found but not confirmed well enough to write, each with why. A
   * claim held from `now` sits beside the record it was left out of.
   */
  held: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        field: Schema.Literals([...fields, "now"]),
        value: Schema.NullOr(Schema.String),
        sources: Schema.Array(Url),
        reason: Schema.String.check(Schema.isNonEmpty()),
      }),
    ),
  ),
});
export type PeopleEntry = typeof PeopleEntry.Type;

export const PeopleFile = Schema.Array(PeopleEntry);
export type PeopleFile = typeof PeopleFile.Type;

/**
 * The file's JSON text, decoded strictly: a field the schema doesn't know,
 * such as a misspelled "website", fails the run instead of being dropped.
 */
export const decodePeopleFile = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PeopleFile),
  { onExcessProperty: "error" },
);

/** A file that cannot be applied as written; nothing was written. */
export class PeopleEnrichmentError extends Schema.TaggedError<PeopleEnrichmentError>()(
  "PeopleEnrichmentError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

class RolledBack extends Schema.TaggedError<RolledBack>()("RolledBack", {
  lines: Schema.Array(Schema.String),
}) {}

const ProfileRow = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
  bio: Schema.String,
  twitter_handle: Schema.NullOr(Schema.String),
  bluesky_handle: Schema.NullOr(Schema.String),
  linkedin_handle: Schema.NullOr(Schema.String),
  photo_source_url: Schema.NullOr(Schema.String),
  has_image: Schema.Boolean,
  now_record: Schema.Unknown,
  x_posts: Schema.Unknown,
});
type ProfileRow = typeof ProfileRow.Type;

/** Blank, or only whitespace: a column with nothing in it yet. */
const isBlank = (value: string | null) => value === null || value.trim() === "";

/**
 * What the stored row holds for `field`. A photo counts as filled once its
 * image is copied, whatever its source column says (even blank), so no new
 * source is ever set beside an image it didn't make.
 */
const stored = (row: ProfileRow, field: Field): string | null =>
  field === "photoSourceUrl" && row.has_image
    ? isBlank(row.photo_source_url)
      ? "(image)"
      : row.photo_source_url
    : (row[columns[field] as keyof ProfileRow] as string | null);

/**
 * Writes a profile's `now_record` where the file's differs from what is
 * stored (`null` clears it), and says what changed, or nothing when
 * nothing did. A stored record that no longer decodes is replaced.
 */
const writeNow = (profileId: string, held: unknown, now: Now | null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const current = yield* decodeStoredNow(held).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    const same =
      current !== undefined &&
      (current === null || now === null
        ? current === now
        : canonicalNow(current) === canonicalNow(now));
    if (same) return undefined;
    yield* sql`
      UPDATE profiles SET
        now_record = ${now === null ? null : canonicalNow(now)}::jsonb,
        updated_at = now()
      WHERE id = ${profileId}::uuid`;
    if (now === null) return "now cleared";
    return current === null || current === undefined
      ? `now ← as of ${now.checkedOn}`
      : `now ${current.checkedOn} → ${now.checkedOn}`;
  });

/**
 * Writes a profile's `x_posts` where the file's differ from what is
 * stored (`null` clears them), and says what changed, or nothing when
 * nothing did. A stored record that no longer decodes is replaced.
 */
const writeXPosts = (profileId: string, held: unknown, posts: XPosts | null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const current = yield* decodeStoredXPosts(held).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    const same =
      current !== undefined &&
      (current === null || posts === null
        ? current === posts
        : canonicalXPosts(current) === canonicalXPosts(posts));
    if (same) return undefined;
    yield* sql`
      UPDATE profiles SET
        x_posts = ${posts === null ? null : canonicalXPosts(posts)}::jsonb,
        updated_at = now()
      WHERE id = ${profileId}::uuid`;
    if (posts === null) return "x posts cleared";
    const count = `${posts.posts.length} ${posts.posts.length === 1 ? "post" : "posts"}`;
    return current === null || current === undefined
      ? `x posts ← ${count}, read ${posts.readOn}`
      : `x posts → ${count}, read ${posts.readOn}`;
  });

/** The X handle that wrote a post, by its address, in lower case. */
const authorOf = (url: string) => statusOf(url)?.handle.toLowerCase();

/** The id of a post on X at `url`, or undefined for any other page. */
const postIdOf = (url: string) => {
  const match =
    /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/([0-9]{1,20})/.exec(
      url,
    );
  return match?.[1];
};

/**
 * Writes `file` in one transaction, filling only blank columns; with
 * `dryRun`, rolls it back after doing everything. Fails, writing nothing,
 * on a profile that isn't stored, whose name no longer matches, or that is
 * listed twice, on a fact that is both held and set, on a "now" record
 * checked after today (UTC), on X posts read after today, by another
 * handle than the profile's, or also linked from its "now".
 */
export const applyPeople = (file: PeopleFile, dryRun: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const fail = (reason: string) =>
      Effect.fail(new PeopleEnrichmentError({ reason }));

    const ids = file.map((entry) => entry.profileId);
    const twice = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (twice.length > 0) {
      return yield* fail(
        `Profiles listed more than once: ${[...new Set(twice)].join(", ")}`,
      );
    }
    const heldAndSet = file.flatMap((entry) =>
      (entry.held ?? [])
        .filter(
          (held) => held.field !== "now" && entry[held.field] !== undefined,
        )
        .map((held) => `${entry.name} ${held.field}`),
    );
    if (heldAndSet.length > 0) {
      return yield* fail(
        `Facts both held and set (drop one): ${heldAndSet.join(", ")}`,
      );
    }
    // A record dated ahead would stay fresh until then (src/now-refresh.ts).
    const today = DateTime.formatIsoDateUtc(yield* asOf);
    const ahead = file.flatMap((entry) =>
      entry.now != null && entry.now.checkedOn > today
        ? [`${entry.name} (${entry.now.checkedOn})`]
        : [],
    );
    if (ahead.length > 0) {
      return yield* fail(
        `Now records checked after today, ${today}: ${ahead.join(", ")}`,
      );
    }
    const readAhead = file.flatMap((entry) =>
      entry.xPosts != null && entry.xPosts.readOn > today
        ? [`${entry.name} (${entry.xPosts.readOn})`]
        : [],
    );
    if (readAhead.length > 0) {
      return yield* fail(
        `X posts read after today, ${today}: ${readAhead.join(", ")}`,
      );
    }

    const work = Effect.gen(function* () {
      const lines: Array<string> = [];
      for (const entry of file) {
        const rows = yield* sql`
          SELECT name, title, bio, twitter_handle, bluesky_handle,
            linkedin_handle, photo_source_url, image IS NOT NULL AS has_image,
            now_record, x_posts
          FROM profiles WHERE id = ${entry.profileId}::uuid
          FOR UPDATE`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ProfileRow))),
        );
        const [row] = rows;
        if (row === undefined) {
          return yield* fail(`No profile has the id ${entry.profileId}.`);
        }
        if (row.name !== entry.name) {
          return yield* fail(
            `Profile ${entry.profileId} is named "${row.name}", not "${entry.name}".`,
          );
        }
        for (const held of entry.held ?? []) {
          lines.push(`held: ${entry.name} ${held.field}: ${held.reason}`);
        }
        const fill: Partial<Record<Field, string>> = {};
        const notes: Array<string> = [];
        for (const field of fields) {
          const value = entry[field]?.value;
          if (value === undefined) continue;
          const current = stored(row, field);
          const was = entry[field]?.was;
          // A photo source is replaced only while nothing has been copied
          // from it: an image already stored stays matched to its source.
          const replaceable = field !== "photoSourceUrl" || !row.has_image;
          if (
            replaceable &&
            was !== undefined &&
            current === was &&
            current !== value
          ) {
            fill[field] = value;
            notes.push(`${columns[field]} "${was}" → ${value}`);
          } else if (isBlank(current)) {
            fill[field] = value;
            notes.push(
              `${columns[field]} ← ${value.length > 60 ? `${value.slice(0, 57)}…` : value}`,
            );
          } else if (current !== value) {
            notes.push(
              `${columns[field]} kept (already "${(current ?? "").slice(0, 40)}")`,
            );
          }
        }
        // The records the profile will hold once this entry is written: the
        // file's where it gives one, else what is stored.
        const nowAfter =
          entry.now !== undefined
            ? entry.now
            : yield* decodeStoredNow(row.now_record).pipe(
                Effect.orElseSucceed(() => null),
              );
        const postsAfter =
          entry.xPosts !== undefined
            ? entry.xPosts
            : yield* decodeStoredXPosts(row.x_posts).pipe(
                Effect.orElseSucceed(() => null),
              );
        if (postsAfter !== null) {
          // Every post by the handle the profile will have.
          const handle = xHandleOf(
            fill.twitterHandle ?? row.twitter_handle,
          )?.toLowerCase();
          const others = postsAfter.posts.filter(
            (post) => authorOf(post.url) !== handle,
          );
          if (others.length > 0) {
            return yield* fail(
              `${entry.name}'s X posts aren't by their X handle (${handle === undefined ? "none" : `@${handle}`}): ${others.map((post) => post.url).join(", ")}${entry.xPosts === undefined ? " (stored; set xPosts to null or to posts by the new handle)" : ""}`,
            );
          }
          // A post is shown once: in "now" or among the X posts, never both.
          const linked = new Set(
            (nowAfter?.links ?? []).flatMap((link) => postIdOf(link.url) ?? []),
          );
          const shown = postsAfter.posts.filter((post) =>
            linked.has(statusOf(post.url)!.id),
          );
          if (shown.length > 0) {
            return yield* fail(
              `X posts also linked from now (keep one): ${shown.map((post) => `${entry.name} ${post.url}`).join(", ")}`,
            );
          }
        }
        if (Object.keys(fill).length > 0) {
          yield* sql`
            UPDATE profiles SET
              title = COALESCE(${fill.title ?? null}, title),
              bio = COALESCE(${fill.bio ?? null}, bio),
              twitter_handle = COALESCE(${fill.twitterHandle ?? null}, twitter_handle),
              bluesky_handle = COALESCE(${fill.blueskyHandle ?? null}, bluesky_handle),
              linkedin_handle = COALESCE(${fill.linkedinHandle ?? null}, linkedin_handle),
              photo_source_url = COALESCE(${fill.photoSourceUrl ?? null}, photo_source_url),
              updated_at = now()
            WHERE id = ${entry.profileId}::uuid`;
        }
        if (entry.now !== undefined) {
          const note = yield* writeNow(
            entry.profileId,
            row.now_record,
            entry.now,
          );
          if (note !== undefined) notes.push(note);
        }
        if (entry.xPosts !== undefined) {
          const note = yield* writeXPosts(
            entry.profileId,
            row.x_posts,
            entry.xPosts,
          );
          if (note !== undefined) notes.push(note);
        }
        lines.push(
          `${entry.name}: ${notes.length === 0 ? "unchanged" : notes.join(", ")}`,
        );
      }
      if (dryRun) return yield* new RolledBack({ lines });
      return lines;
    });

    return yield* sql.withTransaction(work).pipe(
      Effect.catchTag("RolledBack", (rolledBack) =>
        Effect.succeed([...rolledBack.lines, "Dry run: rolled back."]),
      ),
      Effect.catchTag(["SqlError", "SchemaError"], (cause) =>
        Effect.fail(new DataSourceError({ cause })),
      ),
    );
  });
