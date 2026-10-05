import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { HttpUrl } from "./contract.ts";
import { DataSourceError } from "./errors.ts";

/**
 * What profiles lack, filled from public sources (core/backfill/people.json):
 * titles, bios, links and photos for people on published events, each fact
 * with the URL it was read from and the day it was read. Written in one
 * transaction, and only where the profile has nothing yet: a filled column
 * is never overwritten, whatever the file says. A fact that could not be
 * confirmed (a same-name collision, a bio that isn't the person's own
 * words) is kept under `held` with its reason and never written.
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

/** A value, where it was read, and when. */
const fact = <S extends Schema.Top>(value: S) =>
  Schema.Struct({ value, source: Url, read: Day });

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
  title: Schema.optionalKey(fact(Text(120))),
  /** The person's own words, at most lightly trimmed or put in the third person. */
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
  /** Facts found but not confirmed well enough to write, each with why. */
  held: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        field: Schema.Literals(fields),
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
});
type ProfileRow = typeof ProfileRow.Type;

/** Blank, or only whitespace: a column with nothing in it yet. */
const isBlank = (value: string | null) => value === null || value.trim() === "";

/** What the stored row holds for `field`; a photo counts once the image is copied. */
const stored = (row: ProfileRow, field: Field): string | null =>
  field === "photoSourceUrl" && row.has_image
    ? (row.photo_source_url ?? "(image)")
    : (row[columns[field] as keyof ProfileRow] as string | null);

/**
 * Writes `file` in one transaction, filling only blank columns; with
 * `dryRun`, rolls it back after doing everything. Fails, writing nothing,
 * on a profile that isn't stored, whose name no longer matches, or that is
 * listed twice, and on a fact that is both held and set.
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
        .filter((held) => entry[held.field] !== undefined)
        .map((held) => `${entry.name} ${held.field}`),
    );
    if (heldAndSet.length > 0) {
      return yield* fail(
        `Facts both held and set (drop one): ${heldAndSet.join(", ")}`,
      );
    }

    const work = Effect.gen(function* () {
      const lines: Array<string> = [];
      for (const entry of file) {
        const rows = yield* sql`
          SELECT name, title, bio, twitter_handle, bluesky_handle,
            linkedin_handle, photo_source_url, image IS NOT NULL AS has_image
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
          if (isBlank(current)) {
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
