import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { DataSourceError } from "./errors.ts";
import { planShortSlugs } from "./short-slugs.ts";
import { orDataSourceError } from "./sql.ts";

/**
 * Gives every published evening without a short link its own, by the rule
 * in src/short-slugs.ts: the hourly sync does it after the events, so a new
 * evening from Luma has its link within the hour (web/src/sync/run.ts).
 *
 * Who owns what: the site. A link, once given, is recorded in
 * `event_slugs` for good, and `events.short_slug` names the one in use; the
 * step only gives links to evenings without one and never changes one.
 * Drafts get none, so a cancelled evening holds no link; one is given when
 * it is published. `events.slug`, the app's long slug, is never written,
 * and no link may equal one.
 *
 * It reads, then gives every link in one statement: one taken meanwhile
 * fails the statement, which writes nothing, and the next run tries again.
 */

/** A published evening without a link, as the step reads it. */
const Unlinked = Schema.Struct({
  eventId: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  topic: Schema.NullOr(Schema.String),
  curation: Schema.Struct({ kind: Schema.Literals(["ours", "shared"]) }),
  // Nested in JSON, so its instant is ISO text.
  startDate: Schema.DateTimeUtcFromString,
});

const Read = Schema.Struct({
  unlinked: Schema.Array(Unlinked),
  taken: Schema.Array(Schema.String),
});

const Written = Schema.Struct({ written: Schema.Int });

/** A link given to an evening. */
export interface GivenSlug {
  readonly eventId: string;
  /** Its long slug, which redirects to the link from now on. */
  readonly slug: string;
  readonly shortSlug: string;
}

export interface SlugsResult {
  /** Links given (or, for a dry run, to give), in the order the evenings start. */
  readonly given: ReadonlyArray<GivenSlug>;
  /** Evenings given one; null for a dry run. */
  readonly written: number | null;
}

export interface ShortSlugsShape {
  /** Gives each published evening without a link its own, unless `dryRun`. */
  readonly assign: (options: {
    readonly dryRun: boolean;
  }) => Effect.Effect<SlugsResult, DataSourceError>;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  // Every link ever given and every long slug are taken: a link never
  // shadows another evening's.
  const read = sql`
    SELECT
      COALESCE((
        SELECT json_agg(json_build_object(
          'eventId', e.id, 'slug', e.slug, 'name', e.name, 'topic', e.topic,
          'curation', json_build_object('kind', e.curation),
          'startDate', e.start_date
        ) ORDER BY e.start_date, e.id)
        FROM events e
        WHERE e.is_draft = false AND e.short_slug IS NULL
      ), '[]'::json) AS unlinked,
      COALESCE((
        SELECT json_agg(t.slug ORDER BY t.slug)
        FROM (
          SELECT slug FROM event_slugs
          UNION SELECT slug FROM events
        ) t
      ), '[]'::json) AS taken`.pipe(
    Effect.flatMap(([row]) => Schema.decodeUnknownEffect(Read)(row)),
    orDataSourceError,
  );

  const write = (given: ReadonlyArray<GivenSlug>, now: DateTime.Utc) => {
    const rows = JSON.stringify(
      given.map((link) => ({ event_id: link.eventId, slug: link.shortSlug })),
    );
    const at = DateTime.formatIso(now);
    // The link is recorded, then used: the foreign key from events to
    // event_slugs holds once the statement ends.
    return sql`
      WITH claimed AS (
        INSERT INTO event_slugs (slug, event_id, created_at)
        SELECT g.slug, g.event_id, ${at}::timestamptz
        FROM jsonb_to_recordset(${rows}::jsonb) AS g(event_id uuid, slug text)
        RETURNING slug, event_id
      ), used AS (
        UPDATE events e
        SET short_slug = c.slug, updated_at = ${at}::timestamptz
        FROM claimed c
        WHERE e.id = c.event_id AND e.short_slug IS NULL
        RETURNING 1
      )
      SELECT count(*)::int AS written FROM used`.pipe(
      Effect.flatMap(([row]) => Schema.decodeUnknownEffect(Written)(row)),
      Effect.map(({ written }) => written),
      orDataSourceError,
    );
  };

  const assign = ({ dryRun }: { readonly dryRun: boolean }) =>
    Effect.gen(function* () {
      const { unlinked, taken } = yield* read;
      const given = planShortSlugs(unlinked, taken).map(
        ({ event, slug }): GivenSlug => ({
          eventId: event.eventId,
          slug: event.slug,
          shortSlug: slug,
        }),
      );
      const written = dryRun
        ? null
        : given.length === 0
          ? 0
          : yield* write(given, yield* DateTime.now);
      return { given, written } satisfies SlugsResult;
    }).pipe(Effect.withSpan("ShortSlugs.assign", { attributes: { dryRun } }));

  return ShortSlugs.of({ assign });
});

export class ShortSlugs extends Context.Service<ShortSlugs, ShortSlugsShape>()(
  "allthings/ShortSlugs",
) {
  /** Needs a `SqlClient`. */
  static readonly layer = Layer.effect(ShortSlugs, make);
}
