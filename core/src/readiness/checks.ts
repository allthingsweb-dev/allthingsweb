import { DateTime, Duration } from "effect";
import {
  type EventRecord,
  eventCompleteness,
  type GapKind,
  gapKinds,
} from "../completeness.ts";
import {
  formats,
  hours,
  rulesFor,
  scheduleLines,
  sizeLabel,
  sizeOf,
} from "../formats.ts";
import { eventMode } from "../mode.ts";
import { neighborhoodOf } from "../places.ts";
import { sfDay } from "./calendar.ts";

/**
 * Whether a draft evening is ready to go out, as checks over its record: a
 * pure function, so the same rows always give the same answer.
 *
 * The completeness report's rules (src/completeness.ts) run ahead of time:
 * every gap it would find on the published evening, but the ones only a
 * past evening can have (photos, a recording, Luma's guest count). A gap
 * the report requires blocks publishing; one it doesn't is advice. Then
 * what only matters before an evening goes out: it is still a draft, its
 * date is ahead and sane and clear of other evenings that day, its venue
 * is named and placed, it has the schedule its format requires, and once
 * its private Luma event exists, it has a cover. What each program asks
 * for is its format's (src/formats.ts), never decided here.
 */

/** Whether a check stops publishing, or only says what would make it better. */
export type CheckLevel = "blocker" | "advice";

/** The checks only a draft is asked, beyond the completeness report's gaps. */
export const draftCheckKinds = {
  published: "already public",
  "luma-event": "no Luma event yet",
  "starts-in-past": "starts in the past",
  "ends-before-start": "ends before it starts",
  daytime: "starts before 4 PM",
  long: "longer than six hours",
  length: "a length other than its size's default",
  size: "a size to confirm",
  "same-day": "another evening the same day",
  "venue-name": "no venue name",
  neighborhood: "no neighborhood for the venue",
  schedule: "no schedule",
} as const;

export type DraftCheckKind = keyof typeof draftCheckKinds;

export interface Check {
  readonly kind: GapKind | DraftCheckKind;
  readonly level: CheckLevel;
  /** The talk, person, host or other evening it is about, if any. */
  readonly subject: string | null;
  /** What is missing or wrong, in a line. */
  readonly message: string;
}

/** Gaps only a past evening can have, never asked of a draft. */
const pastOnly: ReadonlySet<GapKind> = new Set([
  "photos",
  "recording",
  "guest-count",
]);

/** What a draft is, beyond its completeness record. */
export interface DraftFacts {
  readonly record: EventRecord;
  readonly isDraft: boolean;
  /** The venue's name, as Luma's location name is stored. */
  readonly shortLocation: string | null;
  readonly scheduleItems: number;
}

/** Another event on the calendar, published or draft. */
export interface CalendarEvent {
  readonly slug: string;
  readonly name: string;
  readonly startDate: DateTime.Utc;
  readonly endDate: DateTime.Utc;
  readonly isDraft: boolean;
  readonly curation: "ours" | "shared";
}

/**
 * The longest an evening runs before it reads as a mistake, unless its
 * size runs through the day (a full-day hackathon).
 */
export const longestEvening = Duration.hours(6);

const check = (
  kind: Check["kind"],
  level: CheckLevel,
  message: string,
  subject: string | null = null,
): Check => ({ kind, level, subject, message });

/**
 * Every check on a draft at `now`, blockers first, each group in a fixed
 * order. `calendar` is every other event, published or draft.
 */
export function draftChecks(
  facts: DraftFacts,
  calendar: ReadonlyArray<CalendarEvent>,
  now: DateTime.Utc,
): ReadonlyArray<Check> {
  const { record } = facts;
  const checks: Array<Check> = [];

  if (!facts.isDraft) {
    checks.push(
      check(
        "published",
        "advice",
        "Already public: there is nothing to publish.",
      ),
    );
  }
  if (record.lumaEventId === null) {
    checks.push(
      check(
        "luma-event",
        "advice",
        "No Luma event yet: make the private one before publishing.",
      ),
    );
  }

  if (DateTime.isLessThanOrEqualTo(record.startDate, now)) {
    checks.push(
      check(
        "starts-in-past",
        "blocker",
        `Starts ${DateTime.formatIso(record.startDate)}, which has passed: give it a date ahead.`,
      ),
    );
  }
  if (DateTime.isLessThanOrEqualTo(record.endDate, record.startDate)) {
    checks.push(
      check("ends-before-start", "blocker", "Ends before it starts."),
    );
  }
  const format = formats[record.program];
  const length = DateTime.distance(record.startDate, record.endDate);
  const size = sizeOf(format, length);
  if (!size.allDay) {
    if (eventMode(record.startDate) === "paper") {
      checks.push(
        check(
          "daytime",
          "advice",
          "Starts before 4 PM in San Francisco: it reads as a daytime evening (Paper), not Night.",
        ),
      );
    }
    if (Duration.isGreaterThan(length, longestEvening)) {
      checks.push(
        check(
          "long",
          "advice",
          "Runs longer than six hours: check the end time.",
        ),
      );
    }
  }

  // Lengths are defaults: one that departs from its size's is worth a
  // look, never a stop. A size worth it only as a big deal is confirmed.
  if (size.confirm !== null) {
    checks.push(check("size", "advice", size.confirm));
  }
  if (
    DateTime.isGreaterThan(record.endDate, record.startDate) &&
    !Duration.equals(length, size.duration)
  ) {
    checks.push(
      check(
        "length",
        "advice",
        `Runs ${hours(length)}, doors to close; ${sizeLabel(format, size)} runs ${hours(size.duration)} by default. Keep it if it's meant.`,
      ),
    );
  }

  const day = sfDay(record.startDate);
  for (const other of calendar) {
    if (other.slug === record.slug || sfDay(other.startDate) !== day) continue;
    const ours = other.curation === "ours" && !other.isDraft;
    checks.push(
      check(
        "same-day",
        ours ? "blocker" : "advice",
        ours
          ? `${other.name} is ours the same day (${day}).`
          : `${other.name} is the same day (${day}), ${other.isDraft ? "a draft" : "shared"}.`,
        other.slug,
      ),
    );
  }

  const report = eventCompleteness(record, now);
  for (const gap of report.gaps) {
    if (pastOnly.has(gap.kind)) continue;
    const { required, label } = gapKinds[gap.kind];
    // A cover is made from the brand's template with the Luma event, so it
    // blocks only once that event exists. A description is written on Luma
    // and imported once the evening is public (src/luma/descriptions.ts),
    // so before then it is advice.
    const level: CheckLevel =
      gap.kind === "description"
        ? "advice"
        : gap.kind === "cover"
          ? record.lumaEventId === null
            ? "advice"
            : "blocker"
          : required
            ? "blocker"
            : "advice";
    const message =
      gap.subject === null
        ? capitalize(label)
        : `${capitalize(label)}: ${gap.subject}`;
    checks.push(check(gap.kind, level, message, gap.subject));
  }

  const hasVenue =
    (record.fullAddress ?? record.streetAddress ?? "").trim() !== "";
  if (hasVenue && (facts.shortLocation ?? "").trim() === "") {
    checks.push(
      check(
        "venue-name",
        "advice",
        "No venue name: name the place, as Luma's location does (CodeRabbit, say).",
      ),
    );
  }
  if (
    hasVenue &&
    neighborhoodOf([
      record.streetAddress,
      record.fullAddress,
      facts.shortLocation,
    ]) === null
  ) {
    checks.push(
      check(
        "neighborhood",
        "advice",
        "No neighborhood is known for this venue: add it to src/places.ts and brand/foundations.md.",
      ),
    );
  }
  if (format.scheduleRequired && facts.scheduleItems === 0) {
    checks.push(
      check(
        "schedule",
        "blocker",
        `Its page needs a schedule, as every ${format.name}'s does. Start from: ${scheduleLines(size).join("; ")}.`,
      ),
    );
  }
  // A description, once there is one, must carry the rules (the
  // completeness gap above); before Luma's is imported, say what it needs.
  const rules = rulesFor({ ...record, curation: record.curation.kind });
  const described = !report.gaps.some((entry) => entry.kind === "description");
  if (rules.length > 0 && !described) {
    checks.push(
      check(
        "rules",
        "advice",
        `Its description must carry the ${format.name}'s rules, word for word (the promo drafts do): ${rules.map((rule) => rule.text).join(" ")}`,
      ),
    );
  }

  const order = (level: CheckLevel) => (level === "blocker" ? 0 : 1);
  return checks
    .map((entry, index) => ({ entry, index }))
    .toSorted(
      (a, b) =>
        order(a.entry.level) - order(b.entry.level) || a.index - b.index,
    )
    .map(({ entry }) => entry);
}

const capitalize = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1);
