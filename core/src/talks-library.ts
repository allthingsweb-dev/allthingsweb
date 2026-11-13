import { Context, type DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import {
  artifactsOf,
  ended,
  latestFirst,
  ours,
  published,
  talksOf,
} from "./catalog.ts";
import { asOf } from "./clock.ts";
import type { DataSourceError } from "./errors.ts";
import { type Evening, toEvening } from "./home.ts";
import { httpUrlOrNull } from "./mappers.ts";
import { type StageRole, stageRole } from "./people.ts";
import * as Rows from "./rows.ts";
import { listingJson, orDataSourceError } from "./sql.ts";
import {
  ArtifactRow,
  artifactJson,
  type TalkLinks,
  talkLinks,
} from "./talk-artifacts.ts";

/**
 * The talks library, read as of the `Clock`: every talk given at one of
 * our published evenings once it is over, latest evening first and each
 * evening's talks in its running order. It is the speakers list's scope
 * (src/speakers.ts: ours, once `ended`), read a talk at a time: a talk
 * given at two evenings is listed at each. Evenings we only share are
 * someone else's, and their talks aren't ours to list.
 */

/** Someone on stage, as a talk in the library names them. */
export interface LibrarySpeaker {
  readonly id: string;
  /** Their page's address, /people/<slug>. */
  readonly slug: string;
  readonly name: string;
  /** Their capacity in the talk: speaker, panelist, guest or moderator. */
  readonly role: StageRole;
}

/** One talk, at the evening it was given at. */
export interface LibraryTalk {
  readonly id: string;
  readonly title: string;
  /** How it was held: a talk, a panel or a fireside chat. */
  readonly format: Rows.TalkFormat;
  /** Everyone who gave it, in the order they were attached. */
  readonly speakers: ReadonlyArray<LibrarySpeaker>;
  /** The evening it was given at, as every list shows one. */
  readonly evening: Evening;
  /** The evening's recording, when it has one at an http(s) URL. */
  readonly recordingUrl: string | null;
  /**
   * What the talk left behind (src/talk-artifacts.ts): its own recording,
   * from its start, and its slides, code and other links in order.
   */
  readonly links: TalkLinks;
}

const SpeakerRow = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  role: Rows.SpeakerRole,
});

const TalkRow = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  format: Rows.TalkFormat,
  speakers: Schema.Array(SpeakerRow),
  artifacts: Schema.Array(ArtifactRow),
});

/** One evening with its talks, as the statement reads it. */
export const LibraryRow = Schema.Struct({
  listing: Rows.Listing,
  recordingUrl: Schema.NullOr(Schema.String),
  talks: Schema.Array(TalkRow),
});

export type LibraryRow = typeof LibraryRow.Type;

/** The library from its evenings' rows, in their order, as of `now`. */
export function toLibrary(
  rows: ReadonlyArray<LibraryRow>,
  now: DateTime.Utc,
): ReadonlyArray<LibraryTalk> {
  return rows.flatMap((row) => {
    const evening = toEvening(row.listing, now);
    const recordingUrl = httpUrlOrNull(row.recordingUrl);
    return row.talks.map(
      (talk): LibraryTalk => ({
        id: talk.id,
        title: talk.title,
        format: talk.format,
        speakers: talk.speakers.map((speaker) => ({
          id: speaker.id,
          slug: speaker.slug,
          name: speaker.name,
          role: stageRole(talk.format, speaker.role),
        })),
        evening,
        recordingUrl,
        links: talkLinks(talk.artifacts),
      }),
    );
  });
}

export interface TalksLibraryShape {
  /** Every talk given at our evenings that are over at the `Clock`'s now. */
  readonly read: Effect.Effect<ReadonlyArray<LibraryTalk>, DataSourceError>;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  // One row per evening that had talks, latest first, each with its
  // lineup in the catalog's running order.
  const findEvenings = SqlSchema.findAll({
    Request: Schema.DateTimeUtcFromDate,
    Result: LibraryRow,
    execute: (now) => sql`
      SELECT
        ${sql.literal(listingJson)} AS listing,
        e.recording_url AS "recordingUrl",
        ${talksOf(sql, "e", {
          talk: sql`'id', t.id, 'title', t.title, 'format', t.format,
            'artifacts', ${artifactsOf(sql, artifactJson(sql))}`,
          speaker: sql`json_build_object(
            'id', p.id, 'slug', p.slug, 'name', p.name, 'role', ts.role
          )`,
        })} AS talks
      FROM events e
      WHERE ${published(sql, "e")} AND ${ours(sql, "e")}
        AND ${ended(sql, "e", now)}
        AND EXISTS (SELECT 1 FROM event_talks x WHERE x.event_id = e.id)
      ORDER BY ${latestFirst(sql, "e")}`,
  });

  return TalksLibrary.of({
    read: Effect.gen(function* () {
      const now = yield* asOf;
      return toLibrary(yield* orDataSourceError(findEvenings(now)), now);
    }),
  });
});

export class TalksLibrary extends Context.Service<
  TalksLibrary,
  TalksLibraryShape
>()("allthings/TalksLibrary") {
  static readonly layer = Layer.effect(TalksLibrary, make);
}
