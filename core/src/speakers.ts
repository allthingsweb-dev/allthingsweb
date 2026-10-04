import { Context, DateTime, Effect, Layer, Order, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import type { DataSourceError } from "./errors.ts";
import * as Rows from "./rows.ts";
import { orDataSourceError, profileJson } from "./sql.ts";

/** A speaker and the talks they gave, in their newest-first order. */
export interface DirectorySpeaker {
  readonly profile: Rows.Profile;
  readonly talkIds: ReadonlyArray<string>;
}

/**
 * A talk as given at one event. A talk presented at two events appears twice;
 * co-speakers share one appearance.
 */
export interface TalkAppearance {
  readonly talkId: string;
  readonly title: string;
  readonly description: string;
  readonly speakerIds: ReadonlyArray<string>;
  readonly eventId: string;
  readonly eventName: string;
  readonly eventSlug: string;
  readonly eventStart: DateTime.Utc;
}

/**
 * Everyone who has spoken at a published event that has ended, by name, and
 * every such appearance, newest first.
 */
export interface SpeakerDirectory {
  readonly speakers: ReadonlyArray<DirectorySpeaker>;
  readonly talks: ReadonlyArray<TalkAppearance>;
}

export interface SpeakersShape {
  /** The directory as of the current `Clock` time. */
  readonly directory: Effect.Effect<SpeakerDirectory, DataSourceError>;
}

const newestFirst: Order.Order<TalkAppearance> = Order.combineAll([
  Order.flip(
    Order.mapInput(DateTime.Order, (t: TalkAppearance) => t.eventStart),
  ),
  Order.mapInput(Order.String, (t: TalkAppearance) => t.eventId),
  Order.mapInput(Order.String, (t: TalkAppearance) => t.talkId),
]);

/**
 * Folds one row per (speaker, talk, event) into the directory. A port of
 * app/src/lib/speaker-directory.ts, which the rows' SQL order also follows.
 */
export const toDirectory = (
  rows: ReadonlyArray<Rows.DirectoryRow>,
): SpeakerDirectory => {
  const speakers = new Map<
    string,
    { profile: Rows.Profile; talkIds: string[] }
  >();
  const talks = new Map<
    string,
    Omit<TalkAppearance, "speakerIds"> & { speakerIds: string[] }
  >();
  for (const row of rows) {
    let speaker = speakers.get(row.profile.id);
    if (speaker === undefined) {
      speaker = { profile: row.profile, talkIds: [] };
      speakers.set(row.profile.id, speaker);
    }
    if (!speaker.talkIds.includes(row.talkId)) speaker.talkIds.push(row.talkId);
    const appearanceId = `${row.eventId}:${row.talkId}`;
    let talk = talks.get(appearanceId);
    if (talk === undefined) {
      talk = {
        talkId: row.talkId,
        title: row.talkTitle,
        description: row.talkDescription,
        speakerIds: [],
        eventId: row.eventId,
        eventName: row.eventName,
        eventSlug: row.eventSlug,
        eventStart: row.eventStart,
      };
      talks.set(appearanceId, talk);
    }
    talk.speakerIds.push(row.profile.id);
  }
  return {
    speakers: [...speakers.values()],
    talks: [...talks.values()].sort(newestFirst),
  };
};

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  // An event's talks join the directory once the event has ended; drafts never.
  const findRows = SqlSchema.findAll({
    Request: Schema.DateTimeUtcFromDate,
    Result: Rows.DirectoryRow,
    execute: (now) => sql`
      SELECT
        ${sql.literal(profileJson("p"))} AS profile,
        t.id AS "talkId", t.title AS "talkTitle", t.description AS "talkDescription",
        e.id AS "eventId", e.name AS "eventName", e.slug AS "eventSlug",
        e.start_date AS "eventStart"
      FROM profiles p
      JOIN talk_speakers ts ON ts.speaker_id = p.id
      JOIN talks t ON t.id = ts.talk_id
      JOIN event_talks et ON et.talk_id = t.id
      JOIN events e ON e.id = et.event_id
      WHERE e.is_draft = false AND e.end_date <= ${now}
      ORDER BY p.name, p.id, e.start_date DESC, e.id, t.id`,
  });

  return Speakers.of({
    directory: DateTime.now.pipe(
      Effect.flatMap((now) => orDataSourceError(findRows(now))),
      Effect.map(toDirectory),
    ),
  });
});

export class Speakers extends Context.Service<Speakers, SpeakersShape>()(
  "allthings/Speakers",
) {
  static readonly layer = Layer.effect(Speakers, make);
}
