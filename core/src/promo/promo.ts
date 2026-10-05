import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import type { DataSourceError, EventNotFound } from "../errors.ts";
import { type EventPage, EventPages } from "../event-page.ts";
import { orDataSourceError } from "../sql.ts";
import { type Handles, type PromoDrafts, promoDrafts } from "./drafts.ts";
import { DraftTooLong } from "./limits.ts";

/**
 * Promotion drafts for a published evening (drafts.ts), read from its page
 * and its people's stored handles. Read-only: production's site_reader
 * role is enough, and nothing is ever posted.
 */

export interface PromoOptions {
  /** The site's origin, for links to the evening's page and people. */
  readonly origin: string;
  /** The one origin the page counts photos from. */
  readonly photoOrigin: string;
}

export interface PromoShape {
  readonly drafts: (
    slug: string,
    options: PromoOptions,
  ) => Effect.Effect<
    PromoDrafts,
    EventNotFound | DataSourceError | DraftTooLong
  >;
}

const HandlesRow = Schema.Struct({
  id: Schema.String,
  x: Schema.NullOr(Schema.String),
  bluesky: Schema.NullOr(Schema.String),
  linkedin: Schema.NullOr(Schema.String),
});

/** Everyone the page names: hosts of the evening and everyone on stage. */
export const peopleOf = (event: EventPage): ReadonlyArray<string> => [
  ...new Set([
    ...[...event.organizers, ...event.coHosts, ...event.mcs].map((p) => p.id),
    ...event.talks.flatMap((talk) => talk.speakers.map((s) => s.id)),
  ]),
];

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;
  const pages = yield* EventPages;

  const findHandles = SqlSchema.findAll({
    Request: Schema.NonEmptyArray(Schema.String),
    Result: HandlesRow,
    execute: (ids) => sql`
      SELECT id, twitter_handle AS x, bluesky_handle AS bluesky,
        linkedin_handle AS linkedin
      FROM profiles
      WHERE id IN ${sql.in(ids)}`,
  });

  const handlesOf = (event: EventPage) => {
    const [first, ...rest] = peopleOf(event);
    if (first === undefined) return Effect.succeed(new Map<string, Handles>());
    return orDataSourceError(findHandles([first, ...rest])).pipe(
      Effect.map(
        (rows) =>
          new Map<string, Handles>(
            rows.map(({ id, ...handles }) => [id, handles] as const),
          ),
      ),
    );
  };

  return Promo.of({
    drafts: (slug, { origin, photoOrigin }) =>
      Effect.gen(function* () {
        const event = yield* pages.read(slug, photoOrigin);
        const handles = yield* handlesOf(event);
        return yield* Effect.suspend(() => {
          try {
            return Effect.succeed(promoDrafts({ event, handles, origin }));
          } catch (error) {
            return error instanceof DraftTooLong
              ? Effect.fail(error)
              : Effect.die(error);
          }
        });
      }),
  });
});

export class Promo extends Context.Service<Promo, PromoShape>()(
  "allthings/Promo",
) {
  static readonly layer = Layer.effect(Promo, make).pipe(
    Layer.provide(EventPages.layer),
  );
}
