import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import { held, type Tally, TallyFields, tally } from "./about.ts";
import { calendarZone, soonestFirst, talksOf, yearOf } from "./catalog.ts";
import type * as Contract from "./contract.ts";
import { eventUrl } from "./mappers.ts";
import { asOf } from "./clock.ts";
import { eveningPhoto, wallPicksJson } from "./community.ts";
import { DataSourceError } from "./errors.ts";
import { guestCountFloor } from "./event-page.ts";
import { type HeroPick, wallPhotos } from "./hero-photos.ts";
import { type Evening, toEvening } from "./home.ts";
import * as Rows from "./rows.ts";
import { listingJson } from "./sql.ts";

/**
 * A year of our evenings, read as of the `Clock` in one statement: every
 * evening of ours held in it (published and over, started in that year in
 * San Francisco), with its photo, who was on stage, who hosted it and how
 * many guests Luma counted, and the year's tally, counted as the about
 * page counts its own (src/about.ts) at that year's evenings alone. The
 * year page (/year/<yyyy>) shows it, and the year-end party's slideshow
 * is made from the same view.
 */

/** Someone on stage at an evening. */
export interface OnStage {
  /** Their page's address, /people/<slug>. */
  readonly slug: string;
  readonly name: string;
}

/** One evening of the year, as the year page shows it. */
export interface YearEvening {
  /** The evening as every list shows one: its neighborhood and hosts too. */
  readonly evening: Evening;
  /**
   * The photo that stands for it, as the lab picks one (src/community.ts),
   * or null when it has none on the photo origin.
   */
  readonly photo: Rows.Photo | null;
  /**
   * Everyone who was on stage, each once, in the order they first came
   * on: its talks in running order, each talk's speakers as attached.
   */
  readonly onStage: ReadonlyArray<OnStage>;
  /** Its guests as Luma counted them; null below {@link guestCountFloor}. */
  readonly guests: number | null;
}

export interface YearView {
  readonly year: number;
  /** The year's tally: the about page's, at this year's evenings. */
  readonly tally: Tally;
  /** Every evening held in the year, in the order they were held. */
  readonly evenings: ReadonlyArray<YearEvening>;
  /** Every year with an evening held, latest first, this one among them. */
  readonly years: ReadonlyArray<number>;
}

const OnStageRow = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
});

const EveningRow = Schema.Struct({
  listing: Rows.Listing,
  photo: Schema.NullOr(Rows.Photo),
  guests: Schema.NullOr(Schema.Int),
  talks: Schema.Array(Schema.Struct({ speakers: Schema.Array(OnStageRow) })),
});

/** What the year page reads, in one statement. */
export const YearRow = Schema.Struct({
  ...TallyFields,
  heldEvenings: Schema.Array(EveningRow),
  years: Schema.Array(Schema.Int),
});
export type YearRow = typeof YearRow.Type;

/** Each person once, in the order they first appear. */
const firstAppearances = (
  talks: ReadonlyArray<{
    readonly speakers: ReadonlyArray<typeof OnStageRow.Type>;
  }>,
): ReadonlyArray<OnStage> => {
  const seen = new Map<string, OnStage>();
  for (const talk of talks) {
    for (const { id, slug, name } of talk.speakers) {
      if (!seen.has(id)) seen.set(id, { slug, name });
    }
  }
  return [...seen.values()];
};

/** The year from its row, as of `now`; none when it held no evening. */
export function toYear(
  year: number,
  row: YearRow,
  now: DateTime.Utc,
): Option.Option<YearView> {
  if (row.heldEvenings.length === 0) return Option.none();
  return Option.some({
    year,
    tally: {
      evenings: row.evenings,
      speakers: row.speakers,
      hostingCompanies: row.hostingCompanies,
      guests: row.guests,
    },
    evenings: row.heldEvenings.map((evening) => ({
      evening: toEvening(evening.listing, now),
      photo: evening.photo,
      onStage: firstAppearances(evening.talks),
      guests:
        evening.guests !== null && evening.guests >= guestCountFloor
          ? evening.guests
          : null,
    })),
    years: row.years,
  });
}

/**
 * `view` as the public contract has it (`Contract.Year`), for get_year and
 * /api/v1/years/:year: its pages, people's and photos at absolute URLs on
 * the site at `origin`, and nothing the page leaves out.
 */
export function yearContract(view: YearView, origin: string): Contract.Year {
  return {
    year: view.year,
    url: `${origin}/year/${view.year}`,
    timeZone: calendarZone,
    tally: view.tally,
    evenings: view.evenings.map(
      ({ evening, photo, onStage, guests }): Contract.YearEvening => ({
        slug: evening.slug,
        name: evening.name,
        topic: evening.topic ?? null,
        url: eventUrl(origin, evening.slug),
        startsAt: DateTime.formatIso(evening.startsAt),
        neighborhood: evening.neighborhood,
        hosts: evening.hosts,
        onStage: onStage.map((person) => ({
          name: person.name,
          url: `${origin}/people/${encodeURIComponent(person.slug)}`,
        })),
        guests,
        photo:
          photo === null
            ? null
            : {
                url: photo.url,
                alt: photo.alt,
                width: photo.width,
                height: photo.height,
              },
      }),
    ),
    years: view.years,
  };
}

export interface YearShape {
  /**
   * `year` as of the `Clock`'s now, or none when no evening of ours was
   * held in it. Photos are taken only from `photoOrigin` (such as
   * "https://media.allthings.dev"), the one origin pages may load images
   * from.
   */
  readonly read: (
    year: number,
    photoOrigin: string,
  ) => Effect.Effect<Option.Option<YearView>, DataSourceError>;
  /** Every year with an evening of ours held, latest first. */
  readonly years: Effect.Effect<ReadonlyArray<number>, DataSourceError>;
}

const Request = Schema.Struct({
  now: Schema.DateTimeUtcFromDate,
  year: Schema.Int,
  photoPrefix: Schema.String,
});

/** The years, with each evening's photo picked first from `wall`. */
const make = (wall: ReadonlyArray<HeroPick>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const wallJson = wallPicksJson(wall);

    /** The years of every evening held as of `now`, latest first. */
    const heldYears = (now: Date | DateTime.Utc) => sql`COALESCE((
        SELECT json_agg(y.year ORDER BY y.year DESC)
        FROM (
          SELECT DISTINCT ${yearOf(sql, "e")} AS year
          FROM (${held(sql, now)}) e
        ) y
      ), '[]'::json)`;

    const findYear = SqlSchema.findOne({
      Request,
      Result: YearRow,
      execute: ({ now, year, photoPrefix }) => sql`
        WITH held AS (${held(sql, now, year)})
        SELECT
          ${tally(sql, now)},
          COALESCE((
            SELECT json_agg(y.evening ORDER BY ${soonestFirst(sql, "y")})
            FROM (
              SELECT e.id, e.start_date, json_build_object(
                'listing', ${sql.literal(listingJson)},
                'photo', ${eveningPhoto(sql, wallJson, photoPrefix)},
                'guests', e.luma_guest_count,
                'talks', ${talksOf(sql, "e", {
                  talk: sql`'id', t.id`,
                  speaker: sql`json_build_object(
                    'id', p.id, 'slug', p.slug, 'name', p.name
                  )`,
                })}
              ) AS evening
              FROM held e
            ) y
          ), '[]'::json) AS "heldEvenings",
          ${heldYears(now)} AS years`,
    });

    const findYears = SqlSchema.findOne({
      Request: Schema.DateTimeUtcFromDate,
      Result: Schema.Struct({ years: Schema.Array(Schema.Int) }),
      execute: (now) => sql`SELECT ${heldYears(now)} AS years`,
    });

    return Year.of({
      read: (year, photoOrigin) =>
        Effect.gen(function* () {
          const now = yield* asOf;
          const row = yield* findYear({
            now,
            year,
            photoPrefix: `${photoOrigin}/`,
          });
          return toYear(year, row, now);
        }).pipe(Effect.mapError((cause) => new DataSourceError({ cause }))),
      years: Effect.gen(function* () {
        const now = yield* asOf;
        const { years } = yield* findYears(now);
        return years;
      }).pipe(Effect.mapError((cause) => new DataSourceError({ cause }))),
    });
  });

export class Year extends Context.Service<Year, YearShape>()("allthings/Year") {
  /** With each evening's photo picked first from the wall (core/backfill). */
  static readonly layer = Layer.effect(Year, make(wallPhotos));

  /** With each evening's photo picked first from `wall`, in order. */
  static readonly layerCurating = (wall: ReadonlyArray<HeroPick>) =>
    Layer.effect(Year, make(wall));
}
