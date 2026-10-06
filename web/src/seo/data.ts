import { DataSourceError } from "allthings-core/src/errors.ts";
import { siteSlug } from "allthings-core/src/sql.ts";
import { eventTagline } from "allthings-core/src/tagline.ts";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";

/**
 * What the sitemap and the RSS feed say of each published event: no more
 * than the app's feeds publish (app/src/lib/event-feeds.ts), plus when the
 * event was announced and last changed. Each event is at its short link,
 * or its long slug until it has one. The tagline is the evening in one
 * line: the organizers', or Luma's summary while theirs is a placeholder
 * (core's src/tagline.ts).
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

/** What is read of each event: the feed's fields, and Luma's summary. */
const FeedRow = Schema.Struct({
  ...FeedEvent.fields,
  lumaSummary: Schema.NullOr(Schema.String),
});

export interface FeedDataShape {
  /**
   * Every published event, latest start first and ties broken by id, so
   * the same data always makes the same documents. Drafts never appear.
   */
  readonly listPublished: Effect.Effect<
    ReadonlyArray<FeedEvent>,
    DataSourceError
  >;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;
  const listPublished = SqlSchema.findAll({
    Request: Schema.Void,
    Result: FeedRow,
    execute: () => sql`
      SELECT e.id, ${sql.literal(siteSlug("e"))} AS slug, e.name, e.tagline,
        e.luma_summary AS "lumaSummary",
        e.start_date AS "startDate",
        e.created_at AS "createdAt", e.updated_at AS "updatedAt"
      FROM events e
      WHERE e.is_draft = false
      ORDER BY e.start_date DESC, e.id`,
  });
  return FeedData.of({
    listPublished: listPublished(undefined).pipe(
      Effect.map((rows) =>
        rows.map(
          ({ lumaSummary, ...event }): FeedEvent => ({
            ...event,
            tagline: eventTagline({ tagline: event.tagline, lumaSummary }),
          }),
        ),
      ),
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
