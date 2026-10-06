import { DataSourceError } from "allthings-core/src/errors.ts";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

/**
 * What the sitemap and the RSS feed say of each published event: no more
 * than the app's feeds publish (app/src/lib/event-feeds.ts), plus when the
 * event was announced and last changed.
 */
export const FeedEvent = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  tagline: Schema.String,
  startDate: Schema.DateTimeUtcFromDate,
  createdAt: Schema.DateTimeUtcFromDate,
  updatedAt: Schema.DateTimeUtcFromDate,
});

export type FeedEvent = typeof FeedEvent.Type;

/** A person with a page the sitemap lists: their slug, and when it changed. */
export const FeedPerson = Schema.Struct({
  slug: Schema.String,
  updatedAt: Schema.DateTimeUtcFromDate,
});

export type FeedPerson = typeof FeedPerson.Type;

export interface FeedDataShape {
  /**
   * Every published event, latest start first and ties broken by id, so
   * the same data always makes the same documents. Drafts never appear.
   */
  readonly listPublished: Effect.Effect<
    ReadonlyArray<FeedEvent>,
    DataSourceError
  >;
  /**
   * Everyone who took part in a published evening (on stage, or as its
   * organizer, co-host or MC), by slug, so the same data always makes the
   * same sitemap.
   */
  readonly listPeople: Effect.Effect<
    ReadonlyArray<FeedPerson>,
    DataSourceError
  >;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;
  const listPublished = SqlSchema.findAll({
    Request: Schema.Void,
    Result: FeedEvent,
    execute: () => sql`
      SELECT e.id, e.slug, e.name, e.tagline,
        e.start_date AS "startDate",
        e.created_at AS "createdAt", e.updated_at AS "updatedAt"
      FROM events e
      WHERE e.is_draft = false
      ORDER BY e.start_date DESC, e.id`,
  });
  const listPeople = SqlSchema.findAll({
    Request: Schema.Void,
    Result: FeedPerson,
    execute: () => sql`
      SELECT p.slug, p.updated_at AS "updatedAt"
      FROM profiles p
      WHERE EXISTS (
          SELECT 1 FROM talk_speakers ts
          JOIN event_talks et ON et.talk_id = ts.talk_id
          JOIN events e ON e.id = et.event_id
          WHERE ts.speaker_id = p.id AND e.is_draft = false
        ) OR EXISTS (
          SELECT 1 FROM event_people ep
          JOIN events e ON e.id = ep.event_id
          WHERE ep.profile_id = p.id AND e.is_draft = false
        )
      ORDER BY p.slug`,
  });
  return FeedData.of({
    listPublished: listPublished(undefined).pipe(
      Effect.mapError((cause) => new DataSourceError({ cause })),
    ),
    listPeople: listPeople(undefined).pipe(
      Effect.mapError((cause) => new DataSourceError({ cause })),
    ),
  });
});

/** The rows behind the sitemap and the RSS feed. */
export class FeedData extends Context.Service<FeedData, FeedDataShape>()(
  "allthings/web/FeedData",
) {
  static readonly layer = Layer.effect(FeedData, make);
}
