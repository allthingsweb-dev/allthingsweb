import { DateTime } from "effect";
import { isAvailableOn } from "../planning/model.ts";
import {
  addDays,
  daysBetween,
  daysFrom,
  sfDay,
  weekdayOf,
} from "./calendar.ts";
import type { CalendarEvent } from "./checks.ts";

/**
 * Suggestions for a draft evening, each a pure function of what the
 * database holds, so the same rows always suggest the same, in the same
 * order: speakers from the network whose past talks share the evening's
 * topics, wanted speakers who are free that day, hosts we haven't been
 * with in a while, and open dates. Nothing is ranked by meaning: topics
 * match as words.
 */

/** Words that say nothing about a topic. */
const stopwords: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "our",
  "the",
  "their",
  "this",
  "to",
  "we",
  "what",
  "when",
  "why",
  "with",
  "you",
  "your",
  "all",
  "things",
  "night",
  "evening",
  "talk",
  "talks",
]);

/**
 * The words of `texts`, lowercase, with markup dropped: what topics match
 * on. "Next.js", "C++" and "C#" stay words; a trailing dot doesn't.
 */
export function wordsOf(
  ...texts: ReadonlyArray<string>
): ReadonlyArray<string> {
  const words = new Set<string>();
  for (const text of texts) {
    const plain = text
      .replace(/<[^>]*>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .normalize("NFKC")
      .toLowerCase();
    for (const raw of plain.split(/[^\p{L}\p{N}+#.]+/u)) {
      const word = raw.replace(/^\.+|\.+$/g, "");
      if (word.length < 2 || stopwords.has(word)) continue;
      words.add(word);
    }
    // "alpha-nerd" and "next.js" are also their parts.
    for (const part of plain.split(/[^\p{L}\p{N}]+/u)) {
      if (part.length >= 2 && !stopwords.has(part)) words.add(part);
    }
  }
  return [...words].toSorted();
}

/** A talk someone gave at a published evening that has ended. */
export interface PastTalk {
  readonly title: string;
  readonly description: string;
  readonly eventSlug: string;
  readonly eventName: string;
  readonly eventTopic: string | null;
  readonly endDate: DateTime.Utc;
}

/** Someone in the network, with every talk they gave. */
export interface NetworkPerson {
  readonly profileId: string;
  readonly name: string;
  readonly talks: ReadonlyArray<PastTalk>;
}

export interface SpeakerSuggestion {
  readonly profileId: string;
  readonly name: string;
  /** The evening's words their talks share, sorted. */
  readonly matched: ReadonlyArray<string>;
  readonly talks: number;
  /** Their most recent talk's evening, and when it ended. */
  readonly lastSpoke: { readonly slug: string; readonly endDate: string };
}

/**
 * People in the network whose past talks (titles, descriptions, and their
 * evenings' names and topics) share the most of `terms`, then the ones who
 * spoke most recently, then by name. `exclude` are already on the evening.
 */
export function rankSpeakers(
  terms: ReadonlyArray<string>,
  network: ReadonlyArray<NetworkPerson>,
  exclude: ReadonlySet<string>,
  limit = 10,
): ReadonlyArray<SpeakerSuggestion> {
  const wanted = new Set(terms);
  const ranked = network.flatMap((person) => {
    if (exclude.has(person.profileId) || person.talks.length === 0) return [];
    const said = new Set(
      wordsOf(
        ...person.talks.flatMap((talk) => [
          talk.title,
          talk.description,
          talk.eventName,
          talk.eventTopic ?? "",
        ]),
      ),
    );
    const matched = [...wanted].filter((term) => said.has(term)).toSorted();
    if (matched.length === 0) return [];
    const last = person.talks.reduce((latest, talk) =>
      DateTime.isGreaterThan(talk.endDate, latest.endDate) ? talk : latest,
    );
    return [
      {
        profileId: person.profileId,
        name: person.name,
        matched,
        talks: person.talks.length,
        lastSpoke: {
          slug: last.eventSlug,
          endDate: DateTime.formatIso(last.endDate),
        },
      },
    ];
  });
  return ranked
    .toSorted(
      (a, b) =>
        b.matched.length - a.matched.length ||
        b.lastSpoke.endDate.localeCompare(a.lastSpoke.endDate) ||
        a.name.localeCompare(b.name) ||
        a.profileId.localeCompare(b.profileId),
    )
    .slice(0, limit);
}

/** A wanted speaker, as planning lists them. */
export interface Wanted {
  readonly id: string;
  readonly name: string;
  readonly profileId: string | null;
  readonly status: "wanted" | "asked" | "confirmed" | "declined";
  readonly topics: ReadonlyArray<string>;
  readonly availability: ReadonlyArray<{
    readonly kind: "available" | "unavailable";
    readonly startsOn: string | null;
    readonly endsOn: string | null;
  }>;
}

export interface WantedSuggestion {
  readonly id: string;
  readonly name: string;
  readonly status: Wanted["status"];
  /** Their topics that share a word with the evening's, sorted. */
  readonly matched: ReadonlyArray<string>;
  /** Whether their windows leave them free that day (true without a day). */
  readonly freeThatDay: boolean;
}

const statusRank = { confirmed: 0, asked: 1, wanted: 2, declined: 3 } as const;

/**
 * Wanted speakers whose topics share a word with `terms` (every one, when
 * the evening has no words), never one who declined or is already on it:
 * confirmed, then asked, then wanted; free that day first; most shared
 * words; then by name.
 */
export function rankWanted(
  terms: ReadonlyArray<string>,
  wanted: ReadonlyArray<Wanted>,
  day: string | null,
  exclude: ReadonlySet<string>,
): ReadonlyArray<WantedSuggestion> {
  const evening = new Set(terms);
  return wanted
    .flatMap((speaker) => {
      if (speaker.status === "declined") return [];
      if (speaker.profileId !== null && exclude.has(speaker.profileId))
        return [];
      const matched = speaker.topics
        .filter((topic) => wordsOf(topic).some((word) => evening.has(word)))
        .toSorted();
      if (evening.size > 0 && matched.length === 0) return [];
      return [
        {
          id: speaker.id,
          name: speaker.name,
          status: speaker.status,
          matched,
          freeThatDay: day === null || isAvailableOn(speaker.availability, day),
        },
      ];
    })
    .toSorted(
      (a, b) =>
        statusRank[a.status] - statusRank[b.status] ||
        Number(b.freeThatDay) - Number(a.freeThatDay) ||
        b.matched.length - a.matched.length ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
}

/** A hosting company's record with us. */
export interface HostHistory {
  readonly sponsorId: string;
  readonly name: string;
  /** Our published evenings it hosted. */
  readonly evenings: number;
  readonly lastHosted: DateTime.Utc;
  /** Where its last evening was. */
  readonly lastAddress: string | null;
}

export interface HostSuggestion {
  readonly sponsorId: string;
  readonly name: string;
  readonly evenings: number;
  readonly lastHosted: string;
  readonly daysSince: number;
  readonly lastAddress: string | null;
}

/** How long since a host last had us before it counts as not used recently. */
export const quietDays = 90;

/**
 * Companies that have hosted our evenings but none in the `quietDays`
 * before `day`, longest since first, then those that hosted most, then by
 * name. `exclude` already host this one.
 */
export function quietHosts(
  history: ReadonlyArray<HostHistory>,
  day: string,
  exclude: ReadonlySet<string>,
  limit = 8,
): ReadonlyArray<HostSuggestion> {
  return history
    .flatMap((host) => {
      if (exclude.has(host.sponsorId)) return [];
      const daysSince = daysBetween(sfDay(host.lastHosted), day);
      if (daysSince < quietDays) return [];
      return [
        {
          sponsorId: host.sponsorId,
          name: host.name,
          evenings: host.evenings,
          lastHosted: sfDay(host.lastHosted),
          daysSince,
          lastAddress: host.lastAddress,
        },
      ];
    })
    .toSorted(
      (a, b) =>
        b.daysSince - a.daysSince ||
        b.evenings - a.evenings ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}

export interface OpenDate {
  readonly day: string;
  readonly weekday: number;
  /** How many of the wanted speakers passed in are free that day. */
  readonly wantedFree: number;
}

export interface OpenDates {
  readonly from: string;
  readonly to: string;
  /** The weekdays our evenings have been on most, which the dates keep to. */
  readonly weekdays: ReadonlyArray<number>;
  readonly days: ReadonlyArray<OpenDate>;
}

/** Days kept clear of our own published evenings, each way. */
export const spacingDays = 3;

/**
 * Days from `from` through `to` on the three weekdays our published
 * evenings have been on most (ties to the earlier weekday) with nothing
 * else on the calendar that day, published or draft, ours or shared, and
 * none of our published evenings within `spacingDays`. `self` is the
 * draft's own slug, which never conflicts with itself. Each day counts
 * the `wanted` speakers (the evening's matches) free on it.
 */
export function openDates(
  calendar: ReadonlyArray<CalendarEvent>,
  from: string,
  to: string,
  self: string | null,
  wanted: ReadonlyArray<Wanted>,
  limit = 8,
): OpenDates {
  const others = calendar.filter((event) => event.slug !== self);
  const ours = others.filter(
    (event) => event.curation === "ours" && !event.isDraft,
  );
  const counts = new Map<number, number>();
  for (const event of ours) {
    const weekday = weekdayOf(sfDay(event.startDate));
    counts.set(weekday, (counts.get(weekday) ?? 0) + 1);
  }
  const weekdays = [...counts.entries()]
    .toSorted(([a, x], [b, y]) => y - x || a - b)
    .slice(0, 3)
    .map(([weekday]) => weekday)
    .toSorted((a, b) => a - b);
  const taken = new Set(others.map((event) => sfDay(event.startDate)));
  const ourDays = ours.map((event) => sfDay(event.startDate));
  const days = daysFrom(from, to)
    .filter(
      (day) =>
        (weekdays.length === 0 || weekdays.includes(weekdayOf(day))) &&
        !taken.has(day) &&
        !ourDays.some(
          (other) => Math.abs(daysBetween(other, day)) <= spacingDays,
        ),
    )
    .slice(0, limit)
    .map((day) => ({
      day,
      weekday: weekdayOf(day),
      wantedFree: wanted.filter(
        (speaker) =>
          speaker.status !== "declined" &&
          isAvailableOn(speaker.availability, day),
      ).length,
    }));
  return { from, to, weekdays, days };
}

/**
 * The days dates are suggested in: the two weeks either side of a draft's
 * day, none before tomorrow, else the eight weeks from tomorrow.
 */
export function dateWindow(
  draftDay: string | null,
  today: string,
): { readonly from: string; readonly to: string } {
  const tomorrow = addDays(today, 1);
  const ahead = { from: tomorrow, to: addDays(today, 56) };
  if (draftDay === null) return ahead;
  const to = addDays(draftDay, 14);
  // A draft whose day has passed gets the weeks ahead instead.
  if (to < tomorrow) return ahead;
  const from = addDays(draftDay, -14);
  return { from: from < tomorrow ? tomorrow : from, to };
}
