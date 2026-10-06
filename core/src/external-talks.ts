import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import { HttpUrl } from "./contract.ts";
import { DataSourceError } from "./errors.ts";
import { orDataSourceError } from "./sql.ts";

/**
 * Talks people gave elsewhere: at conferences, other meetups, on podcasts
 * and in videos (`external_talks`). They come from a sourced backfill
 * (core/backfill/external-talks.json): every talk with the URL its facts
 * were read from and the day they were read; what could not be confirmed
 * (a date, a same-name speaker) is kept under `held` with its reason and
 * never written. `ExternalTalks` reads them for person pages.
 */

export const externalTalkKinds = [
  "conference",
  "meetup",
  "podcast",
  "video",
  "workshop",
] as const;
export type ExternalTalkKind = (typeof externalTalkKinds)[number];

/** An https URL with a domain-name host, as the public contract accepts, and no whitespace. */
const Url = HttpUrl.check(Schema.isPattern(/^https:\/\/\S+$/));

/** A day on the calendar, YYYY-MM-DD: never a February 30th. */
const Day = Schema.String.check(
  Schema.makeFilter((value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "expected a YYYY-MM-DD day";
    const day = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(day.getTime()) &&
      day.toISOString().slice(0, 10) === value
      ? undefined
      : `${value} is not a day on the calendar`;
  }),
);

const Text = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.makeFilter((value: string) =>
    value.trim() === value ? undefined : "expected no surrounding space",
  ),
);

export const ExternalTalkEntry = Schema.Struct({
  /** The speaker's profile, and its name as stored, which must still match. */
  profileId: Schema.String.check(
    Schema.isPattern(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    ),
  ),
  name: Text,
  title: Text,
  eventName: Text,
  kind: Schema.Literals(externalTalkKinds),
  givenOn: Day,
  url: Schema.NullOr(Url),
  videoUrl: Schema.NullOr(Url),
  source: Url,
  read: Day,
  /**
   * What the source alone doesn't say: a title that is the speaker's word
   * or only descriptive, or a source that copies another. Kept in the file,
   * never written.
   */
  note: Schema.optionalKey(Text),
});
export type ExternalTalkEntry = typeof ExternalTalkEntry.Type;

export const ExternalTalksFile = Schema.Struct({
  talks: Schema.Array(ExternalTalkEntry),
  /** Talks found but not confirmed well enough to write, each with why. */
  held: Schema.Array(
    Schema.Struct({
      name: Text,
      title: Text,
      eventName: Schema.NullOr(Schema.String),
      sources: Schema.Array(Url),
      reason: Text,
    }),
  ),
});
export type ExternalTalksFile = typeof ExternalTalksFile.Type;

/**
 * The file's JSON text, decoded strictly: a field the schema doesn't know
 * fails the run instead of being dropped.
 */
export const decodeExternalTalksFile = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ExternalTalksFile),
  { onExcessProperty: "error" },
);

/** A file that cannot be applied as written; nothing was written. */
export class ExternalTalksError extends Schema.TaggedError<ExternalTalksError>()(
  "ExternalTalksError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

class RolledBack extends Schema.TaggedError<RolledBack>()("RolledBack", {
  lines: Schema.Array(Schema.String),
}) {}

/**
 * Writes `file`'s talks in one transaction: a talk new to its speaker (by
 * title and day) is added, one already there takes the file's event, kind,
 * links and source where they differ. With `dryRun`, rolls it back after
 * doing everything. Fails, writing nothing, on a profile that isn't stored,
 * whose name no longer matches, or a talk listed twice.
 */
export const applyExternalTalks = (file: ExternalTalksFile, dryRun: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const fail = (reason: string) =>
      Effect.fail(new ExternalTalksError({ reason }));

    const keys = file.talks.map(
      (talk) => `${talk.profileId} ${talk.title} ${talk.givenOn}`,
    );
    const twice = file.talks.filter(
      (_, index) => keys.indexOf(keys[index] ?? "") !== index,
    );
    if (twice.length > 0) {
      return yield* fail(
        `Talks listed more than once: ${twice.map((t) => `${t.name}: "${t.title}" (${t.givenOn})`).join(", ")}`,
      );
    }

    const work = Effect.gen(function* () {
      const lines: Array<string> = file.held.map(
        (held) => `held: ${held.name}: "${held.title}": ${held.reason}`,
      );
      const names = new Map<string, string>();
      for (const talk of file.talks) {
        if (!names.has(talk.profileId)) {
          const rows = yield* sql<{ name: string }>`
            SELECT name FROM profiles WHERE id = ${talk.profileId}::uuid`;
          const [row] = rows;
          if (row === undefined) {
            return yield* fail(`No profile has the id ${talk.profileId}.`);
          }
          names.set(talk.profileId, row.name);
        }
        if (names.get(talk.profileId) !== talk.name) {
          return yield* fail(
            `Profile ${talk.profileId} is named "${names.get(talk.profileId) ?? ""}", not "${talk.name}".`,
          );
        }
        const written = yield* sql<{ added: boolean }>`
          INSERT INTO external_talks (profile_id, title, event_name, kind,
            given_on, url, video_url, source_url, read_on, updated_at)
          VALUES (${talk.profileId}::uuid, ${talk.title}, ${talk.eventName},
            ${talk.kind}, ${talk.givenOn}::date, ${talk.url}, ${talk.videoUrl},
            ${talk.source}, ${talk.read}::date, now())
          ON CONFLICT (profile_id, title, given_on) DO UPDATE SET
            event_name = excluded.event_name, kind = excluded.kind,
            url = excluded.url, video_url = excluded.video_url,
            source_url = excluded.source_url, read_on = excluded.read_on,
            updated_at = excluded.updated_at
          WHERE (external_talks.event_name, external_talks.kind,
              external_talks.url, external_talks.video_url,
              external_talks.source_url)
            IS DISTINCT FROM (excluded.event_name, excluded.kind, excluded.url,
              excluded.video_url, excluded.source_url)
          RETURNING (xmax = 0) AS added`;
        const [outcome] = written;
        lines.push(
          `${talk.name}: "${talk.title}" (${talk.eventName}, ${talk.givenOn}): ${
            outcome === undefined
              ? "already there"
              : outcome.added
                ? "added"
                : "updated"
          }`,
        );
      }
      if (dryRun) return yield* new RolledBack({ lines });
      return lines;
    });

    return yield* sql.withTransaction(work).pipe(
      Effect.catchTag("RolledBack", (rolledBack) =>
        Effect.succeed([...rolledBack.lines, "Dry run: rolled back."]),
      ),
      Effect.catchTag("SqlError", (cause) =>
        Effect.fail(new DataSourceError({ cause })),
      ),
    );
  });

/** A talk given elsewhere, as person pages show it. */
export const ExternalTalk = Schema.Struct({
  profileId: Schema.String,
  title: Schema.String,
  eventName: Schema.String,
  kind: Schema.Literals(externalTalkKinds),
  /** The day it was given or published, YYYY-MM-DD. */
  givenOn: Schema.String,
  url: Schema.NullOr(Schema.String),
  videoUrl: Schema.NullOr(Schema.String),
});
export type ExternalTalk = typeof ExternalTalk.Type;

export interface ExternalTalksShape {
  /**
   * The talks each of `profileIds` gave elsewhere, latest first (then by
   * title), keyed by profile; a profile with none is absent.
   */
  readonly forProfiles: (
    profileIds: ReadonlyArray<string>,
  ) => Effect.Effect<
    ReadonlyMap<string, ReadonlyArray<ExternalTalk>>,
    DataSourceError
  >;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;
  const find = SqlSchema.findAll({
    Request: Schema.NonEmptyArray(Schema.String),
    Result: ExternalTalk,
    execute: (ids) => sql`
      SELECT profile_id AS "profileId", title, event_name AS "eventName", kind,
        to_char(given_on, 'YYYY-MM-DD') AS "givenOn", url,
        video_url AS "videoUrl"
      FROM external_talks
      WHERE profile_id IN ${sql.in(ids)}
      ORDER BY given_on DESC, title, id`,
  });
  return ExternalTalks.of({
    forProfiles: (profileIds) => {
      const [first, ...rest] = profileIds;
      if (first === undefined) return Effect.succeed(new Map());
      return orDataSourceError(find([first, ...rest])).pipe(
        Effect.map((rows) => {
          const byProfile = new Map<string, Array<ExternalTalk>>();
          for (const row of rows) {
            const list = byProfile.get(row.profileId) ?? [];
            list.push(row);
            byProfile.set(row.profileId, list);
          }
          return byProfile;
        }),
      );
    },
  });
});

export class ExternalTalks extends Context.Service<
  ExternalTalks,
  ExternalTalksShape
>()("allthings/ExternalTalks") {
  static readonly layer = Layer.effect(ExternalTalks, make);
}
