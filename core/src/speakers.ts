import { Context, DateTime, Effect, Layer, Order, Schema } from "effect";
import { asOf } from "./clock.ts";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import { latestFirst, talkAppearances } from "./catalog.ts";
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
    talks: [...talks.values()].toSorted(newestFirst),
  };
};

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  // Talks at any published evening join the directory once it is over, as
  // eventStatus has it: not at its last instant, while it is still live.
  const findRows = SqlSchema.findAll({
    Request: Schema.DateTimeUtcFromDate,
    Result: Rows.DirectoryRow,
    execute: (now) => sql`
      SELECT
        ${sql.literal(profileJson)} AS profile,
        t.id AS "talkId", t.title AS "talkTitle", t.description AS "talkDescription",
        e.id AS "eventId", e.name AS "eventName", e.slug AS "eventSlug",
        e.start_date AS "eventStart"
      FROM ${talkAppearances(sql, {
        whose: "any",
        when: { ended: now },
      })} a
      JOIN profiles p ON p.id = a.profile_id
      JOIN talks t ON t.id = a.talk_id
      JOIN events e ON e.id = a.event_id
      ORDER BY p.name, p.id, ${latestFirst(sql, "e")}, t.id`,
  });

  return Speakers.of({
    directory: asOf.pipe(
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
