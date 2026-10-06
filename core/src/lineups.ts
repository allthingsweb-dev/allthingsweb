import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { HttpUrl } from "./contract.ts";
import { DataSourceError } from "./errors.ts";

/**
 * Lineups researched from public sources (core/backfill/lineups.json), written
 * to the database in one transaction: the talks each event lacked, with
 * their speakers and roles, the people around each event, and profiles for
 * people the site has none for. Every fact in the file carries its sources.
 * An entry marked `hold` (with the reason) stays in the file and is never
 * applied ({@link applicable}); the run lists what it held.
 *
 * Applying is safe to repeat. Where an event already has a talk with the
 * same title, that talk takes the file's format and speaker roles and gains
 * any missing speakers, keeping its title and description; a new person reuses the one profile that already
 * has their exact name (several stop the run); event_people rows that exist
 * stay. An event is found by its Luma id, or by its slug where it has none.
 * What an event lists under `remove` goes first: a talk taken off it, with
 * its speakers when no other evening has it, and a person's part in it,
 * named only by an existing profile. A dry run does all of it, reports, and
 * rolls back.
 */

/**
 * Why an entry waits, such as "needs Erik: title unknown". A held entry is
 * kept in the file, with its sources, and never applied.
 */
const Hold = Schema.optionalKey(Schema.String.check(Schema.isNonEmpty()));

/** An https URL with a domain-name host, as the public contract accepts, and no whitespace. */
const Url = HttpUrl.check(Schema.isPattern(/^https:\/\/\S+$/));
/**
 * Word from an organizer, for what only someone who was there can say (a
 * talk's title, who sat on a panel): who said it, on what day, and where.
 */
const Confirmation = Schema.Struct({
  confirmedBy: Schema.String.check(Schema.isNonEmpty()),
  on: Schema.String.check(
    Schema.makeFilter((value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return "expected a YYYY-MM-DD day";
      }
      const day = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(day.getTime()) &&
        day.toISOString().slice(0, 10) === value
        ? undefined
        : `${value} is not a day on the calendar`;
    }),
  ),
  in: Schema.String.check(Schema.isNonEmpty()),
});

/** Where a fact comes from: public pages, or an organizer's word. */
const Sources = Schema.Array(Schema.Union([Url, Confirmation])).check(
  Schema.isMinLength(1),
);

/**
 * A talk's start with its offset, "2026-09-30T18:41:00-07:00": a day on the
 * calendar, a time on the clock, a real offset, so the database never
 * refuses it halfway through a run.
 */
const StartsAt = Schema.String.check(
  Schema.makeFilter((value: string) => {
    const match =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(
        value,
      );
    if (match === null)
      return "expected a time with its offset, such as 2026-09-30T18:41:00-07:00";
    const [
      ,
      year,
      month,
      day,
      hour,
      minute,
      second,
      ,
      offsetHours,
      offsetMinutes,
    ] = match;
    const date = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day)),
    );
    const realDay =
      date.getUTCFullYear() === Number(year) &&
      date.getUTCMonth() === Number(month) - 1 &&
      date.getUTCDate() === Number(day);
    const realTime =
      Number(hour) <= 23 &&
      Number(minute) <= 59 &&
      Number(second ?? 0) <= 59 &&
      Number(offsetHours ?? 0) <= 14 &&
      Number(offsetMinutes ?? 0) <= 59;
    return realDay && realTime ? undefined : `${value} is not a real time`;
  }),
);

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
    hold: Hold,
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
    hold: Hold,
    sources: Sources,
  }),
]);

const Confidence = Schema.Literals(["high", "medium"]);

export const Lineups = Schema.Struct({
  people: Schema.Record(Schema.String, Person),
  events: Schema.Array(
    Schema.Struct({
      /** The event by its Luma id, or by its slug where it has none. */
      lumaEventId: Schema.optionalKey(Schema.String),
      slug: Schema.optionalKey(Schema.String),
      name: Schema.String,
      hold: Hold,
      /** Set where the event has no recording link yet. */
      recordingUrl: Schema.optionalKey(Url),
      talks: Schema.Array(
        Schema.Struct({
          title: Schema.String.check(Schema.isNonEmpty()),
          format: Schema.Literals(["talk", "panel", "fireside"]),
          description: Schema.String,
          /** Its place in the evening's running order, from 0. */
          position: Schema.optionalKey(
            Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
          ),
          /** When it started, with its offset: "2026-09-30T18:41:00-07:00". */
          startsAt: Schema.optionalKey(StartsAt),
          speakers: Schema.Array(
            Schema.Struct({
              person: Schema.String,
              role: Schema.Literals(["speaker", "moderator"]),
            }),
          ).check(Schema.isMinLength(1)),
          sources: Sources,
          confidence: Confidence,
          hold: Hold,
        }),
      ),
      people: Schema.Array(
        Schema.Struct({
          person: Schema.String,
          role: Schema.Literals(["organizer", "co-host", "mc"]),
          sources: Sources,
          hold: Hold,
        }),
      ),
      /**
       * What the record has that the evening didn't: talks to take off it
       * (a talk on no other evening goes with its speakers), and people's
       * parts in it. Only ever what a source says was wrong.
       */
      remove: Schema.optionalKey(
        Schema.Struct({
          talks: Schema.optionalKey(
            Schema.Array(
              Schema.Struct({
                title: Schema.String.check(Schema.isNonEmpty()),
                sources: Sources,
              }),
            ),
          ),
          people: Schema.optionalKey(
            Schema.Array(
              Schema.Struct({
                person: Schema.String,
                role: Schema.Literals(["organizer", "co-host", "mc"]),
                sources: Sources,
              }),
            ),
          ),
        }),
      ),
    }).check(
      Schema.makeFilter((event) =>
        event.lumaEventId !== undefined || event.slug !== undefined
          ? undefined
          : `${event.name}: needs a lumaEventId or a slug`,
      ),
    ),
  ),
});
export type Lineups = typeof Lineups.Type;

/** People a lineup names that the file does not define. */
export function undefinedPeople(lineups: Lineups): ReadonlyArray<string> {
  const named = lineups.events.flatMap((event) => [
    ...event.talks.flatMap((talk) => talk.speakers.map((s) => s.person)),
    ...event.people.map((p) => p.person),
    ...(event.remove?.people ?? []).map((p) => p.person),
  ]);
  return [...new Set(named)].filter((key) => !(key in lineups.people));
}

/**
 * The part of `lineups` to apply: every event, talk and event person not
 * held, and the people they name. An event left with nothing to apply is
 * dropped. A person no applied entry names is kept
 * only to fill in an existing profile, unless held; a profile to create is
 * never made for held entries alone.
 */
export function applicable(lineups: Lineups): Lineups {
  const events = lineups.events
    .filter((event) => event.hold === undefined)
    .map((event) => ({
      ...event,
      talks: event.talks.filter((talk) => talk.hold === undefined),
      people: event.people.filter((person) => person.hold === undefined),
    }))
    .filter(
      (event) =>
        event.talks.length > 0 ||
        event.people.length > 0 ||
        event.recordingUrl !== undefined ||
        (event.remove?.talks?.length ?? 0) > 0 ||
        (event.remove?.people?.length ?? 0) > 0,
    );
  const named = new Set(
    events.flatMap((event) => [
      ...event.talks.flatMap((talk) => talk.speakers.map((s) => s.person)),
      ...event.people.map((p) => p.person),
      ...(event.remove?.people ?? []).map((p) => p.person),
    ]),
  );
  const people = Object.fromEntries(
    Object.entries(lineups.people).filter(
      ([key, person]) =>
        named.has(key) ||
        (person.hold === undefined &&
          "profileId" in person &&
          person.fill !== undefined),
    ),
  );
  return { people, events };
}

/** Held people an entry that is not held names: a contradiction. */
export function heldButNamed(lineups: Lineups): ReadonlyArray<string> {
  const named = new Set(
    applicable({ people: {}, events: lineups.events }).events.flatMap(
      (event) => [
        ...event.talks.flatMap((talk) => talk.speakers.map((s) => s.person)),
        ...event.people.map((p) => p.person),
        ...(event.remove?.people ?? []).map((p) => p.person),
      ],
    ),
  );
  return Object.entries(lineups.people)
    .filter(([key, person]) => person.hold !== undefined && named.has(key))
    .map(([key]) => key);
}

/** Every held entry, as "<what>: <why>", in file order. */
export function heldEntries(lineups: Lineups): ReadonlyArray<string> {
  const held: Array<string> = [];
  for (const [key, person] of Object.entries(lineups.people)) {
    if (person.hold !== undefined) held.push(`person ${key}: ${person.hold}`);
  }
  for (const event of lineups.events) {
    if (event.hold !== undefined) {
      held.push(`event ${event.name}: ${event.hold}`);
      continue;
    }
    for (const talk of event.talks) {
      if (talk.hold !== undefined) {
        held.push(`talk "${talk.title}" (${event.name}): ${talk.hold}`);
      }
    }
    for (const person of event.people) {
      if (person.hold !== undefined) {
        held.push(
          `${person.role} ${person.person} (${event.name}): ${person.hold}`,
        );
      }
    }
  }
  return held;
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
export const applyLineups = (file: Lineups, dryRun: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const lines: Array<string> = heldEntries(file).map((h) => `held: ${h}`);
    const lineups = applicable(file);
    const fail = (reason: string) => Effect.fail(new LineupError({ reason }));

    /**
     * Sets a talk's place in the evening's running order and its start where
     * the file gives them; the count of rows changed (0 or 1). A file can't
     * clear either: unplacing a talk is a manual update.
     */
    const place = (
      eventId: string,
      talkId: string,
      talk: { readonly position?: number; readonly startsAt?: string },
    ) =>
      talk.position === undefined && talk.startsAt === undefined
        ? Effect.succeed(0)
        : sql`
            UPDATE event_talks SET
              position = COALESCE(${talk.position ?? null}, position),
              starts_at = COALESCE(${talk.startsAt ?? null}::timestamptz, starts_at),
              updated_at = now()
            WHERE event_id = ${eventId}::uuid AND talk_id = ${talkId}::uuid
              AND (position, starts_at) IS DISTINCT FROM
                (COALESCE(${talk.position ?? null}, position),
                 COALESCE(${talk.startsAt ?? null}::timestamptz, starts_at))
            RETURNING 1`.pipe(Effect.map((rows) => rows.length));

    const missing = undefinedPeople(file);
    if (missing.length > 0) {
      return yield* fail(
        `People not defined in the file: ${missing.join(", ")}`,
      );
    }
    const newcomers = lineups.events
      .flatMap((event) => event.remove?.people ?? [])
      .map((removed) => removed.person)
      .filter((key) => {
        const person = file.people[key];
        return person !== undefined && !("profileId" in person);
      });
    if (newcomers.length > 0) {
      return yield* fail(
        `Removals name people by a profile they already have, not a new one: ${[...new Set(newcomers)].join(", ")}`,
      );
    }
    const contradicted = heldButNamed(file);
    if (contradicted.length > 0) {
      return yield* fail(
        `Held people named by entries that are not held (hold those entries too): ${contradicted.join(", ")}`,
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
        const key = event.lumaEventId ?? event.slug ?? "";
        const [row] = yield* sql<{ id: string; name: string }>`
          SELECT id, name FROM events WHERE ${
            event.lumaEventId === undefined
              ? sql`slug = ${key}`
              : sql`luma_event_id = ${key}`
          }`;
        if (row === undefined) {
          return yield* fail(
            `No event has the ${event.lumaEventId === undefined ? "slug" : "Luma id"} ${key}`,
          );
        }
        lines.push(`${key} ${row.name}`);
        for (const removed of event.remove?.talks ?? []) {
          const matches = yield* sql<{ id: string }>`
            SELECT t.id FROM event_talks et JOIN talks t ON t.id = et.talk_id
            WHERE et.event_id = ${row.id}::uuid AND lower(t.title) = lower(${removed.title})`;
          // Several talks by that title: which one the file means is unsaid.
          if (matches.length > 1) {
            return yield* fail(
              `${key}: ${matches.length} talks are titled "${removed.title}"; none was removed`,
            );
          }
          const [talk] = matches;
          if (talk === undefined) {
            lines.push(`  talk "${removed.title}": not there`);
            continue;
          }
          yield* sql`DELETE FROM event_talks
            WHERE event_id = ${row.id}::uuid AND talk_id = ${talk.id}::uuid`;
          const [elsewhere] = yield* sql<{ n: number }>`
            SELECT count(*)::int AS n FROM event_talks WHERE talk_id = ${talk.id}::uuid`;
          if ((elsewhere?.n ?? 0) === 0) {
            yield* sql`DELETE FROM talk_speakers WHERE talk_id = ${talk.id}::uuid`;
            yield* sql`DELETE FROM talks WHERE id = ${talk.id}::uuid`;
          }
          lines.push(
            `  talk "${removed.title}": removed${(elsewhere?.n ?? 0) === 0 ? ", with its speakers" : " (still on another evening)"}`,
          );
        }
        for (const removed of event.remove?.people ?? []) {
          const gone = yield* sql`
            DELETE FROM event_people
            WHERE event_id = ${row.id}::uuid
              AND profile_id = ${profileIds.get(removed.person) ?? ""}::uuid
              AND role = ${removed.role}
            RETURNING 1`;
          lines.push(
            `  ${removed.role} ${removed.person}: ${gone.length === 0 ? "not there" : "removed"}`,
          );
        }
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
            const placed = yield* place(row.id, taken.id, talk);
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
              changed.length + speakersChanged + placed === 0
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
            INSERT INTO event_talks (event_id, talk_id, position, starts_at, created_at, updated_at)
            VALUES (${row.id}::uuid, ${created.id}::uuid,
              ${talk.position ?? null}, ${talk.startsAt ?? null}::timestamptz,
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
