import { DateTime, Effect, Schema } from "effect";
import guideFile from "../backfill/guide.json" with { type: "json" };
import { asOf } from "./clock.ts";
import { HttpUrl } from "./contract.ts";
import { addDays, sfDay } from "./readiness/calendar.ts";

/**
 * The allthings guide: happenings beyond our evenings worth going to,
 * starred the way the Michelin guide stars a restaurant. Three stars are
 * worth a special journey, two a detour, one a stop. What earns them is
 * the people, the talks and what gets built there.
 *
 * The stars are the organizers' judgment, written by hand in
 * core/backfill/guide.json, never counted or voted. The guide is editorial,
 * as the wall's photos are (src/hero-photos.ts): it names other people's
 * happenings, which we neither sync nor host, so it is a sourced file read
 * and checked here at import, not a table. Every fact in it comes from the
 * happening's own site, listed under `sources`; a next edition's dates are
 * written only once its organizers announce them.
 */

/** How far a happening is worth going, as Michelin's stars say it. */
export const Stars = Schema.Literals([1, 2, 3]);
export type Stars = typeof Stars.Type;

/** What each star count means, in the guide's words. */
export const starMeaning: Readonly<Record<Stars, string>> = {
  3: "worth a special journey",
  2: "worth a detour",
  1: "worth a stop",
};

/** What each star count asks of you, in a line under its meaning. */
export const starAdvice: Readonly<Record<Stars, string>> = {
  3: "Plan a trip around it.",
  2: "Go out of your way when you're nearby.",
  1: "Go when you're in town.",
};

/** An https URL with a domain-name host, as the public contract accepts, and no whitespace. */
const Url = HttpUrl.check(Schema.isPattern(/^https:\/\/\S+$/));

const Text = Schema.String.check(
  Schema.isPattern(/^\S(?:.*\S)?$/, {
    message:
      "must say something on one line, without leading or trailing space",
  }),
);

/** One plain sentence: a capital first, a full stop last, on one line. */
const Sentence = Text.check(
  Schema.isPattern(/^[A-Z].*[^.]\.$/, {
    message:
      "must be one sentence, starting with a capital and ending in one full stop",
  }),
);

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

/** An edition's days where it happens, both included. */
export const Edition = Schema.Struct({
  from: Day,
  to: Day,
}).check(
  Schema.makeFilter((edition) =>
    edition.from <= edition.to ? undefined : "must end on or after its start",
  ),
);
export type Edition = typeof Edition.Type;

export const GuideEntry = Schema.Struct({
  /** Stable and lowercase, for links into the guide: /guide#<id>. */
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  /** As its organizers write it. */
  name: Text,
  stars: Stars,
  /** Where it happens: "Portland, Oregon". */
  city: Text,
  /** Who runs it, as its site says. */
  organizer: Text,
  /** Its official site. */
  url: Url,
  /** Why it's worth the journey, in one plain sentence. */
  why: Sentence,
  /** The next edition's days, once its organizers announce them. */
  next: Schema.optionalKey(Edition),
  /** Where every fact above comes from: its own site first. */
  sources: Schema.Array(Url).check(Schema.isMinLength(1)),
});
export type GuideEntry = typeof GuideEntry.Type;

/** The ids or names an entry list has more than once. */
export function repeated(
  entries: ReadonlyArray<Pick<GuideEntry, "id" | "name">>,
): ReadonlyArray<string> {
  const twice = (values: ReadonlyArray<string>) =>
    values.filter((value, i) => values.indexOf(value) !== i);
  return [
    ...new Set([
      ...twice(entries.map((entry) => entry.id)),
      ...twice(entries.map((entry) => entry.name)),
    ]),
  ];
}

export const GuideFile = Schema.Struct({
  entries: Schema.Array(GuideEntry).check(
    Schema.makeFilter((entries) => {
      const twice = repeated(entries);
      return twice.length === 0
        ? undefined
        : `names more than once: ${twice.join(", ")}`;
    }),
  ),
});
export type GuideFile = typeof GuideFile.Type;

/** Every entry in the guide, as written. */
export const guideEntries: ReadonlyArray<GuideEntry> =
  Schema.decodeUnknownSync(GuideFile)(guideFile).entries;

/** An entry as the guide shows it on a given day. */
export interface GuideListing {
  readonly id: string;
  readonly name: string;
  readonly stars: Stars;
  readonly city: string;
  readonly organizer: string;
  readonly url: string;
  readonly why: string;
  /**
   * Its next edition's days, while that edition hasn't ended; once it has,
   * none until the following one is announced and written.
   */
  readonly next: Edition | null;
}

/** The entries with one star count, under what it means. */
export interface StarGroup {
  readonly stars: Stars;
  readonly meaning: string;
  readonly advice: string;
  readonly entries: ReadonlyArray<GuideListing>;
}

/** `entry` as the guide shows it on `today`, a San Francisco day. */
export function listing(entry: GuideEntry, today: string): GuideListing {
  const next = entry.next !== undefined && entry.next.to >= today;
  return {
    id: entry.id,
    name: entry.name,
    stars: entry.stars,
    city: entry.city,
    organizer: entry.organizer,
    url: entry.url,
    why: entry.why,
    next: next ? (entry.next ?? null) : null,
  };
}

/**
 * The guide on `today` (a San Francisco day, YYYY-MM-DD): three stars
 * first, then two, then one, leaving out a count with no entries. Within a
 * count, the entries with dates come first, the soonest first, then the
 * rest by name.
 */
export function guideOn(
  entries: ReadonlyArray<GuideEntry>,
  today: string,
): ReadonlyArray<StarGroup> {
  const listed = entries.map((entry) => listing(entry, today));
  const order = (a: GuideListing, b: GuideListing) =>
    a.next !== null && b.next !== null
      ? a.next.from.localeCompare(b.next.from) || a.name.localeCompare(b.name)
      : a.next !== null
        ? -1
        : b.next !== null
          ? 1
          : a.name.localeCompare(b.name);
  return ([3, 2, 1] as const).flatMap((stars) => {
    const inGroup = listed
      .filter((entry) => entry.stars === stars)
      .toSorted(order);
    return inGroup.length === 0
      ? []
      : [
          {
            stars,
            meaning: starMeaning[stars],
            advice: starAdvice[stars],
            entries: inGroup,
          },
        ];
  });
}

/** The guide as of `now`, in San Francisco. */
export const guideAt = (now: DateTime.DateTime): ReadonlyArray<StarGroup> =>
  guideOn(guideEntries, sfDay(now));

/** The guide as of the `Clock`'s minute (src/clock.ts). */
export const readGuide: Effect.Effect<ReadonlyArray<StarGroup>> = Effect.map(
  asOf,
  guideAt,
);

const sanFrancisco = DateTime.zoneMakeNamedUnsafe("America/Los_Angeles");

/** The instant `day` (YYYY-MM-DD) begins in San Francisco, in epoch milliseconds. */
const sfMidnight = (day: string): number =>
  DateTime.toEpochMillis(
    DateTime.makeZonedUnsafe(`${day}T00:00:00`, {
      timeZone: sanFrancisco,
      adjustForTimeZone: true,
    }),
  );

/**
 * When the guide changes with no write: the start of the San Francisco day
 * after each written edition's last, when its days leave the guide
 * (`listing`). Epoch milliseconds, ascending, without repeats. The site's
 * version names them among its boundaries (src/site-version.ts), so a page
 * the Worker keeps never shows an edition's days once it is over.
 */
export const guideBoundaries: ReadonlyArray<number> = [
  ...new Set(
    guideEntries.flatMap((entry) =>
      entry.next === undefined ? [] : [sfMidnight(addDays(entry.next.to, 1))],
    ),
  ),
].toSorted((a, b) => a - b);
