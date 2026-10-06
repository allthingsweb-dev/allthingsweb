import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { DataSourceError } from "./errors.ts";
import { heldSlugs, type NeedsSlug, planShortSlugs } from "./short-slugs.ts";
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
  lumaEventId: Schema.NullOr(Schema.String),
  slug: Schema.String,
  name: Schema.String,
  topic: Schema.NullOr(Schema.String),
  curation: Schema.Struct({ kind: Schema.Literals(["ours", "shared"]) }),
  // Nested in JSON, so its instant is ISO text.
  startDate: Schema.DateTimeUtcFromString,
});

/** A slug, and the evening that holds it. */
const Held = Schema.Array(
  Schema.Struct({ slug: Schema.String, eventId: Schema.String }),
);

const Read = Schema.Struct({
  unlinked: Schema.Array(Unlinked),
  links: Held,
  longSlugs: Held,
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

/**
 * A draft a dry run of the sync would publish, which the database still
 * holds as a draft: its Luma id, and its name and start if they change too.
 */
export interface PublishedDraft {
  readonly lumaEventId: string;
  readonly name?: string;
  readonly startDate?: DateTime.Utc;
}

/** An evening a dry run of the sync would create, which the database lacks. */
export interface PendingEvening extends NeedsSlug {
  /** Its long slug. */
  readonly slug: string;
}

export interface ShortSlugsShape {
  /**
   * Gives each published evening without a link its own, unless `dryRun`.
   * A dry run may name evenings the sync would create (`pending`) and
   * drafts it would publish (`published`), so it lists the links they
   * would get too, in the order they all start.
   */
  readonly assign: (
    options:
      | { readonly dryRun: false }
      | {
          readonly dryRun: true;
          readonly pending?: ReadonlyArray<PendingEvening>;
          readonly published?: ReadonlyArray<PublishedDraft>;
        },
  ) => Effect.Effect<SlugsResult, DataSourceError>;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  // Every link ever given and every long slug are held, each by its
  // evening: a link never shadows another evening's. Drafts a dry run says
  // the sync would publish are read as the evenings they would be.
  const read = (published: ReadonlyArray<string>) =>
    sql`
    SELECT
      COALESCE((
        SELECT json_agg(json_build_object(
          'eventId', e.id, 'lumaEventId', e.luma_event_id, 'slug', e.slug, 'name', e.name, 'topic', e.topic,
          'curation', json_build_object('kind', e.curation),
          'startDate', e.start_date
        ) ORDER BY e.start_date, e.id)
        FROM events e
        WHERE e.short_slug IS NULL AND (e.is_draft = false OR e.luma_event_id IN (
          SELECT jsonb_array_elements_text(${JSON.stringify(published)}::jsonb)
        ))
      ), '[]'::json) AS unlinked,
      COALESCE((
        SELECT json_agg(json_build_object('slug', es.slug, 'eventId', es.event_id)
          ORDER BY es.slug)
        FROM event_slugs es
      ), '[]'::json) AS links,
      COALESCE((
        SELECT json_agg(json_build_object('slug', e.slug, 'eventId', e.id)
          ORDER BY e.slug)
        FROM events e
      ), '[]'::json) AS "longSlugs"`.pipe(
      Effect.flatMap(([row]) => Schema.decodeUnknownEffect(Read)(row)),
      orDataSourceError,
    );

  const write = (given: ReadonlyArray<GivenSlug>, now: DateTime.Utc) => {
    const rows = JSON.stringify(
      given.map((link) => ({ event_id: link.eventId, slug: link.shortSlug })),
    );
    const at = DateTime.formatIso(now);
    // The link is recorded (unless the evening holds it already), then
    // used. The foreign key from events to event_slugs, checked once the
    // statement ends, holds each link to its own evening: one another
    // evening took meanwhile fails the statement.
    return sql`
      WITH given AS (
        SELECT * FROM jsonb_to_recordset(${rows}::jsonb) AS g(event_id uuid, slug text)
      ), claimed AS (
        INSERT INTO event_slugs (slug, event_id, created_at)
        SELECT g.slug, g.event_id, ${at}::timestamptz FROM given g
        ON CONFLICT (slug) DO NOTHING
      ), used AS (
        UPDATE events e
        SET short_slug = g.slug, updated_at = ${at}::timestamptz
        FROM given g
        WHERE e.id = g.event_id AND e.short_slug IS NULL
        RETURNING 1
      )
      SELECT count(*)::int AS written FROM used`.pipe(
      Effect.flatMap(([row]) => Schema.decodeUnknownEffect(Written)(row)),
      Effect.map(({ written }) => written),
      orDataSourceError,
    );
  };

  const assign: ShortSlugsShape["assign"] = (options) =>
    Effect.gen(function* () {
      const { dryRun } = options;
      const pending = options.dryRun ? (options.pending ?? []) : [];
      const published = new Map(
        (options.dryRun ? (options.published ?? []) : []).map((draft) => [
          draft.lumaEventId,
          draft,
        ]),
      );
      const { unlinked, links, longSlugs } = yield* read([...published.keys()]);
      const evenings = unlinked.map((evening) => {
        const draft =
          evening.lumaEventId === null
            ? undefined
            : published.get(evening.lumaEventId);
        return draft === undefined
          ? evening
          : {
              ...evening,
              name: draft.name ?? evening.name,
              startDate: draft.startDate ?? evening.startDate,
            };
      });
      const given = planShortSlugs(
        [...evenings, ...pending],
        heldSlugs(links, longSlugs),
      ).map(
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
    }).pipe(
      Effect.withSpan("ShortSlugs.assign", {
        attributes: { dryRun: options.dryRun },
      }),
    );

  return ShortSlugs.of({ assign });
});

export class ShortSlugs extends Context.Service<ShortSlugs, ShortSlugsShape>()(
  "allthings/ShortSlugs",
) {
  /** Needs a `SqlClient`. */
  static readonly layer = Layer.effect(ShortSlugs, make);
}

const RehearsedFields = Schema.Struct({
  name: Schema.String,
  // Nested in JSON, so its instant is ISO text.
  startDate: Schema.DateTimeUtcFromString,
  isDraft: Schema.Boolean,
});

/**
 * The published evenings a rehearsed sync would create (`created`, from
 * src/luma/sync.ts), as a dry run of this step takes them: new evenings
 * are ours and have no topic yet, as the sync inserts them.
 */
export function pendingEvenings(
  created: ReadonlyArray<{
    readonly lumaEventId: string;
    readonly slug: string;
    readonly fields: Readonly<Record<string, unknown>>;
  }>,
): ReadonlyArray<PendingEvening> {
  return created.flatMap(({ lumaEventId, slug, fields }) =>
    Option.match(Schema.decodeUnknownOption(RehearsedFields)(fields), {
      onNone: () => [],
      onSome: ({ name, startDate, isDraft }): Array<PendingEvening> =>
        isDraft
          ? []
          : [
              {
                eventId: `pending:${lumaEventId}`,
                slug,
                name,
                topic: null,
                curation: { kind: "ours" },
                startDate,
              },
            ],
    }),
  );
}

const PublishingChanges = Schema.Struct({
  isDraft: Schema.Struct({
    before: Schema.Literal(true),
    after: Schema.Literal(false),
  }),
  name: Schema.optionalKey(Schema.Struct({ after: Schema.String })),
  // Nested in JSON, so its instant is ISO text.
  startDate: Schema.optionalKey(
    Schema.Struct({ after: Schema.DateTimeUtcFromString }),
  ),
});

/**
 * The drafts a rehearsed sync would publish (`updated`, from
 * src/luma/sync.ts), as a dry run of this step takes them: the rehearsal
 * rolls back, so the database still holds them as drafts.
 */
export function publishedDrafts(
  updated: ReadonlyArray<{
    readonly lumaEventId: string;
    readonly changes: Readonly<Record<string, unknown>>;
  }>,
): ReadonlyArray<PublishedDraft> {
  return updated.flatMap(({ lumaEventId, changes }) =>
    Option.match(Schema.decodeUnknownOption(PublishingChanges)(changes), {
      onNone: () => [],
      onSome: ({ name, startDate }): Array<PublishedDraft> => [
        {
          lumaEventId,
          ...(name === undefined ? {} : { name: name.after }),
          ...(startDate === undefined ? {} : { startDate: startDate.after }),
        },
      ],
    }),
  );
}
