import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { DataSourceError } from "./errors.ts";

/**
 * Lineups researched from public sources (core/backfill/lineups.json), written
 * to the database in one transaction: the talks each event lacked, with
 * their speakers and roles, the people around each event, and profiles for
 * people the site has none for. Every fact in the file carries its sources.
 *
 * Applying is safe to repeat. Where an event already has a talk with the
 * same title, that talk takes the file's format and speaker roles and gains
 * any missing speakers, keeping its title and description; a new person reuses the one profile that already
 * has their exact name (several stop the run); event_people rows that exist
 * stay. A dry run does all of it, reports, and rolls back.
 */

const Url = Schema.String.check(Schema.isPattern(/^https:\/\/\S+$/));
const Sources = Schema.Array(Url).check(Schema.isMinLength(1));

/** Someone a lineup names: an existing profile, or one to create. */
export const Person = Schema.Union([
  Schema.Struct({
    profileId: Schema.String,
    /** Columns to fill where the profile has nothing yet; never overwritten. */
    fill: Schema.optionalKey(
      Schema.Struct({
        title: Schema.optionalKey(Schema.String),
        twitterHandle: Schema.optionalKey(Schema.String),
        blueskyHandle: Schema.optionalKey(Schema.String),
        linkedinHandle: Schema.optionalKey(Schema.String),
        photoSourceUrl: Schema.optionalKey(Url),
      }),
    ),
    sources: Sources,
  }),
  Schema.Struct({
    create: Schema.Struct({
      name: Schema.String.check(Schema.isNonEmpty()),
      title: Schema.String,
      bio: Schema.String,
      twitterHandle: Schema.NullOr(Schema.String),
      blueskyHandle: Schema.NullOr(Schema.String),
      linkedinHandle: Schema.NullOr(Schema.String),
      photoSourceUrl: Schema.NullOr(Url),
    }),
    sources: Sources,
  }),
]);

const Confidence = Schema.Literals(["high", "medium"]);

export const Lineups = Schema.Struct({
  people: Schema.Record(Schema.String, Person),
  events: Schema.Array(
    Schema.Struct({
      lumaEventId: Schema.String,
      name: Schema.String,
      /** Set where the event has no recording link yet. */
      recordingUrl: Schema.optionalKey(Url),
      talks: Schema.Array(
        Schema.Struct({
          title: Schema.String.check(Schema.isNonEmpty()),
          format: Schema.Literals(["talk", "panel", "fireside"]),
          description: Schema.String,
          speakers: Schema.Array(
            Schema.Struct({
              person: Schema.String,
              role: Schema.Literals(["speaker", "moderator"]),
            }),
          ).check(Schema.isMinLength(1)),
          sources: Sources,
          confidence: Confidence,
        }),
      ),
      people: Schema.Array(
        Schema.Struct({
          person: Schema.String,
          role: Schema.Literals(["organizer", "co-host", "mc"]),
          sources: Sources,
        }),
      ),
    }),
  ),
});
export type Lineups = typeof Lineups.Type;

/** People a lineup names that the file does not define. */
export function undefinedPeople(lineups: Lineups): ReadonlyArray<string> {
  const named = lineups.events.flatMap((event) => [
    ...event.talks.flatMap((talk) => talk.speakers.map((s) => s.person)),
    ...event.people.map((p) => p.person),
  ]);
  return [...new Set(named)].filter((key) => !(key in lineups.people));
}

/** A lineup that cannot be applied as written; nothing was written. */
export class LineupError extends Schema.TaggedError<LineupError>()(
  "LineupError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

/** What applying did, line by line. */
export interface Applied {
  readonly lines: ReadonlyArray<string>;
}

class RolledBack extends Schema.TaggedError<RolledBack>()("RolledBack", {
  lines: Schema.Array(Schema.String),
}) {}

/**
 * Writes `lineups` in one transaction; with `dryRun`, rolls it back after
 * doing everything. Fails, writing nothing, on an unknown event or profile,
 * or a new person whose name several profiles have.
 */
export const applyLineups = (lineups: Lineups, dryRun: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const lines: Array<string> = [];
    const fail = (reason: string) => Effect.fail(new LineupError({ reason }));

    const missing = undefinedPeople(lineups);
    if (missing.length > 0) {
      return yield* fail(
        `People not defined in the file: ${missing.join(", ")}`,
      );
    }

    // Attach order is the file's order: each join row a millisecond after
    // the last, so rows written together never tie.
    const started = Date.now();
    let tick = 0;
    const stamp = () => new Date(started + tick++).toISOString();

    const work = Effect.gen(function* () {
      const profileIds = new Map<string, string>();
      for (const [key, person] of Object.entries(lineups.people)) {
        if ("profileId" in person) {
          const found = yield* sql<{ name: string }>`
            SELECT name FROM profiles WHERE id = ${person.profileId}::uuid`;
          const [row] = found;
          if (row === undefined) {
            return yield* fail(`${key}: no profile ${person.profileId}`);
          }
          profileIds.set(key, person.profileId);
          const fill = person.fill ?? {};
          const blank = (column: string) =>
            sql.literal(`COALESCE(btrim(${column}), '') = ''`);
          const filled = yield* sql<{ name: string }>`
            WITH next AS (
              SELECT id,
                CASE WHEN ${blank("title")} THEN COALESCE(${fill.title ?? null}, title) ELSE title END AS title,
                CASE WHEN ${blank("twitter_handle")} THEN COALESCE(${fill.twitterHandle ?? null}, twitter_handle) ELSE twitter_handle END AS twitter_handle,
                CASE WHEN ${blank("bluesky_handle")} THEN COALESCE(${fill.blueskyHandle ?? null}, bluesky_handle) ELSE bluesky_handle END AS bluesky_handle,
                CASE WHEN ${blank("linkedin_handle")} THEN COALESCE(${fill.linkedinHandle ?? null}, linkedin_handle) ELSE linkedin_handle END AS linkedin_handle,
                CASE WHEN image IS NULL AND photo_source_url IS NULL THEN ${fill.photoSourceUrl ?? null} ELSE photo_source_url END AS photo_source_url
              FROM profiles WHERE id = ${person.profileId}::uuid
            )
            UPDATE profiles p SET
              title = n.title, twitter_handle = n.twitter_handle,
              bluesky_handle = n.bluesky_handle, linkedin_handle = n.linkedin_handle,
              photo_source_url = n.photo_source_url, updated_at = now()
            FROM next n
            WHERE p.id = n.id
              AND (p.title, p.twitter_handle, p.bluesky_handle, p.linkedin_handle, p.photo_source_url)
                IS DISTINCT FROM (n.title, n.twitter_handle, n.bluesky_handle, n.linkedin_handle, n.photo_source_url)
            RETURNING p.name`;
          if (filled.length > 0) lines.push(`profile ${row.name}: filled in`);
          continue;
        }
        const p = person.create;
        const same = yield* sql<{ id: string }>`
          SELECT id FROM profiles WHERE name = ${p.name}`;
        if (same.length > 1) {
          return yield* fail(
            `${key}: ${same.length} profiles are named ${p.name}`,
          );
        }
        const [existing] = same;
        if (existing !== undefined) {
          lines.push(`profile ${p.name}: exists (${existing.id}), reused`);
          profileIds.set(key, existing.id);
          continue;
        }
        const [created] = yield* sql<{ id: string }>`
          INSERT INTO profiles (name, title, bio, profile_type, twitter_handle,
            bluesky_handle, linkedin_handle, photo_source_url, updated_at)
          VALUES (${p.name}, ${p.title}, ${p.bio}, 'member', ${p.twitterHandle},
            ${p.blueskyHandle}, ${p.linkedinHandle}, ${p.photoSourceUrl}, now())
          RETURNING id`;
        if (created === undefined) return yield* fail(`${key}: not created`);
        lines.push(`profile ${p.name}: created (${created.id})`);
        profileIds.set(key, created.id);
      }

      for (const event of lineups.events) {
        const [row] = yield* sql<{ id: string; name: string }>`
          SELECT id, name FROM events WHERE luma_event_id = ${event.lumaEventId}`;
        if (row === undefined) {
          return yield* fail(`No event has the Luma id ${event.lumaEventId}`);
        }
        lines.push(`${event.lumaEventId} ${row.name}`);
        if (event.recordingUrl !== undefined) {
          const recorded = yield* sql`
            UPDATE events SET recording_url = ${event.recordingUrl}, updated_at = now()
            WHERE id = ${row.id}::uuid AND COALESCE(btrim(recording_url), '') = ''
            RETURNING 1`;
          lines.push(
            `  recording: ${recorded.length === 0 ? "already set" : "added"}`,
          );
        }
        for (const talk of event.talks) {
          const [taken] = yield* sql<{ id: string }>`
            SELECT t.id FROM event_talks et JOIN talks t ON t.id = et.talk_id
            WHERE et.event_id = ${row.id}::uuid AND lower(t.title) = lower(${talk.title})`;
          if (taken !== undefined) {
            // The event already has this talk: bring its format and its
            // speakers' roles in line, add missing speakers, and leave its
            // title and description as the site wrote them.
            const changed = yield* sql`
              UPDATE talks SET format = ${talk.format}, updated_at = now()
              WHERE id = ${taken.id}::uuid AND format <> ${talk.format}
              RETURNING 1`;
            let speakersChanged = 0;
            for (const speaker of talk.speakers) {
              const written = yield* sql`
                INSERT INTO talk_speakers (talk_id, speaker_id, role, created_at, updated_at)
                VALUES (${taken.id}::uuid, ${profileIds.get(speaker.person) ?? ""}::uuid,
                  ${speaker.role}, ${stamp()}::timestamptz, now())
                ON CONFLICT (talk_id, speaker_id) DO UPDATE SET
                  role = excluded.role, updated_at = excluded.updated_at
                WHERE talk_speakers.role <> excluded.role
                RETURNING 1`;
              speakersChanged += written.length;
            }
            lines.push(
              changed.length + speakersChanged === 0
                ? `  talk "${talk.title}": already as written`
                : `  talk "${talk.title}": updated (${talk.format}; ${talk.speakers
                    .map((s) => `${s.person} ${s.role}`)
                    .join(", ")})`,
            );
            continue;
          }
          const [created] = yield* sql<{ id: string }>`
            INSERT INTO talks (title, description, format, updated_at)
            VALUES (${talk.title}, ${talk.description}, ${talk.format}, now())
            RETURNING id`;
          if (created === undefined) return yield* fail(`talk ${talk.title}`);
          yield* sql`
            INSERT INTO event_talks (event_id, talk_id, created_at, updated_at)
            VALUES (${row.id}::uuid, ${created.id}::uuid,
              ${stamp()}::timestamptz, now())`;
          for (const speaker of talk.speakers) {
            yield* sql`
              INSERT INTO talk_speakers (talk_id, speaker_id, role, created_at, updated_at)
              VALUES (${created.id}::uuid, ${profileIds.get(speaker.person) ?? ""}::uuid,
                ${speaker.role}, ${stamp()}::timestamptz, now())`;
          }
          lines.push(
            `  talk "${talk.title}" (${talk.format}): ${talk.speakers
              .map((s) => `${s.person} ${s.role}`)
              .join(", ")}`,
          );
        }
        for (const person of event.people) {
          const written = yield* sql`
            INSERT INTO event_people (event_id, profile_id, role, position, source, updated_at)
            SELECT ${row.id}::uuid, ${profileIds.get(person.person) ?? ""}::uuid, ${person.role},
              COALESCE((SELECT max(position) + 1 FROM event_people
                WHERE event_id = ${row.id}::uuid AND role = ${person.role}), 0),
              'site', now()
            ON CONFLICT (event_id, profile_id, role) DO NOTHING
            RETURNING 1`;
          lines.push(
            `  ${person.role} ${person.person}: ${written.length === 0 ? "already there" : "added"}`,
          );
        }
      }
      if (dryRun) return yield* new RolledBack({ lines });
      return { lines } satisfies Applied;
    });

    return yield* sql.withTransaction(work).pipe(
      Effect.catchTag("RolledBack", (rolledBack) =>
        Effect.succeed<Applied>({
          lines: [...rolledBack.lines, "Dry run: rolled back."],
        }),
      ),
      Effect.catchTag("SqlError", (cause) =>
        Effect.fail(new DataSourceError({ cause })),
      ),
    );
  });
