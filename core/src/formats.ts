import { DateTime, Duration } from "effect";
import { sfDay } from "./readiness/calendar.ts";
import type { EventProgram } from "./rows.ts";

/**
 * What each kind of evening is, in one place: its definition, what it must
 * have before it goes out and what would make it better, how long it runs
 * and the schedule it starts from, and the rules everyone who comes is told.
 *
 * Every rule about a program is here and only here. The completeness
 * report (src/completeness.ts), readiness (src/readiness/checks.ts), the
 * event page (web/src/pages/event.tsx) and the promo drafts
 * (src/promo/drafts.ts) read it; docs/event-formats.md is generated from it
 * (`bun run formats:doc`), and CI fails when the two differ.
 */

/** One step of a schedule: minutes after doors, and what happens. */
export interface ScheduleStep {
  readonly at: number;
  readonly title: string;
}

/** A rule everyone who comes to the evening is told, and holds to. */
export interface PublicRule {
  readonly id: string;
  /** As attendees read it, word for word, on the page and on Luma. */
  readonly text: string;
  /** Why it is a rule, for the organizers and the doc. */
  readonly why: string;
  /**
   * The first San Francisco day (YYYY-MM-DD) it applies to: an evening
   * that started before was held without it, and is never said to lack it.
   */
  readonly since: string;
}

export interface Format {
  readonly program: EventProgram;
  /** As copy names it, lowercase. */
  readonly name: string;
  /** What the evening is, in a sentence or two. */
  readonly definition: string;
  /**
   * What its page shows on stage: its talks, an open floor (with any demos
   * we know of), or nothing.
   */
  readonly stage: "talks" | "open-floor" | null;
  /** Whether a complete record of it has talks. */
  readonly talksRequired: boolean;
  /**
   * Whether it may start before 4 PM and run past the longest evening
   * without advice: a hackathon runs through the day.
   */
  readonly allDay: boolean;
  /** How long it runs, doors to close, unless planned otherwise. */
  readonly duration: Duration.Duration;
  /** Whether its page needs a schedule before it goes out. */
  readonly scheduleRequired: boolean;
  /** The schedule a new one starts from. */
  readonly schedule: ReadonlyArray<ScheduleStep>;
  /** What everyone who comes is told: on its page, on Luma, on Meetup. */
  readonly rules: ReadonlyArray<PublicRule>;
}

/**
 * Projects at a hackathon are judged on their code, which has to be open.
 * In Erik's words (2026-10-06): people now use agents at hackathons, and it
 * is way too easy to vibe something for a demo that doesn't really work.
 */
export const openSourceProjects: PublicRule = {
  id: "open-source",
  text: "Projects must be open source to be judged: a public repository under an OSI-approved license.",
  why: "Agents make it easy to build a demo that doesn't really work. Open code lets us check a project with automated tools and tests, CodeRabbit's review, and by checking it out ourselves, to judge how real it is.",
  since: "2026-10-06",
};

export const formats: Readonly<Record<EventProgram, Format>> = {
  talks: {
    program: "talks",
    name: "talks",
    definition:
      "A lineup on stage: talks, panels and fireside chats, with time before and after to meet people.",
    stage: "talks",
    talksRequired: true,
    allDay: false,
    duration: Duration.hours(3),
    scheduleRequired: false,
    schedule: [
      { at: 0, title: "Doors open: food, drinks and people" },
      { at: 45, title: "On stage" },
      { at: 135, title: "Time to talk, until close" },
    ],
    rules: [],
  },
  "open-floor": {
    program: "open-floor",
    name: "open floor",
    definition: "No lineup: anyone can get up and show what they're building.",
    stage: "open-floor",
    talksRequired: false,
    allDay: false,
    duration: Duration.hours(3),
    scheduleRequired: false,
    schedule: [
      { at: 0, title: "Doors open: food, drinks and people" },
      { at: 45, title: "Open floor: anyone can show what they're building" },
      { at: 135, title: "Time to talk, until close" },
    ],
    rules: [],
  },
  social: {
    program: "social",
    name: "social evening",
    definition:
      "No stage: an evening to meet people over food and drinks, sometimes around a game such as trivia.",
    stage: null,
    talksRequired: false,
    allDay: false,
    duration: Duration.hours(3),
    scheduleRequired: false,
    schedule: [{ at: 0, title: "Doors open: food, drinks and people" }],
    rules: [],
  },
  hackathon: {
    program: "hackathon",
    name: "hackathon",
    definition:
      "Teams build something in a set time, then show it, and judges pick the winners.",
    stage: null,
    talksRequired: false,
    allDay: true,
    duration: Duration.hours(8),
    scheduleRequired: true,
    schedule: [
      { at: 0, title: "Doors open: food, drinks and forming teams" },
      { at: 30, title: "Kickoff: the theme, the rules and how judging works" },
      { at: 60, title: "Hacking" },
      { at: 360, title: "Submissions close: each team's public repository" },
      { at: 375, title: "Demos" },
      { at: 450, title: "Judging and awards" },
    ],
    rules: [openSourceProjects],
  },
};

/** Every program, in the order the doc and lists give them. */
export const programs: ReadonlyArray<EventProgram> = [
  "talks",
  "open-floor",
  "social",
  "hackathon",
];

/**
 * The rules an evening's attendees are told: its program's rules in effect
 * on the day it starts. An evening we only share is someone else's, held
 * to their rules, never ours.
 */
export function rulesFor(event: {
  readonly program: EventProgram;
  readonly startDate: DateTime.DateTime;
  readonly curation: "ours" | "shared";
}): ReadonlyArray<PublicRule> {
  if (event.curation !== "ours") return [];
  const day = sfDay(event.startDate);
  return formats[event.program].rules.filter((rule) => rule.since <= day);
}

/** The references a description may spell a rule's characters with. */
const references: Readonly<Record<string, string>> = {
  amp: "&",
  nbsp: " ",
  quot: '"',
  apos: "'",
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
  ndash: "–",
  mdash: "—",
};

/** A numeric reference's character; one no character has reads as a space. */
const character = (codePoint: number): string =>
  codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : " ";

/**
 * Text as rules are compared: a description's words without its markup
 * (stored HTML, Luma's or the site's), in one case, with one kind of
 * quote and single spaces.
 */
const normalized = (text: string): string =>
  text
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);?/g, (_, digits: string) => character(Number(digits)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) =>
      character(Number.parseInt(hex, 16)),
    )
    .replace(
      /&([a-z]+);/gi,
      (entity, name: string) => references[name.toLowerCase()] ?? entity,
    )
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * The rules a description doesn't carry, word for word (spacing, case and
 * curly quotes aside), so attendees reading it on Luma are told each one.
 */
export function rulesMissing(
  description: string,
  rules: ReadonlyArray<PublicRule>,
): ReadonlyArray<PublicRule> {
  const text = normalized(description);
  return rules.filter((rule) => !text.includes(normalized(rule.text)));
}

/** "+1:30" for 90: a step's time after doors. */
export const offset = (minutes: number): string =>
  `+${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/** The schedule a new evening of `format` starts from, a line a step. */
export const scheduleLines = (format: Format): ReadonlyArray<string> =>
  format.schedule.map((step) => `${offset(step.at)} ${step.title}`);

const hours = (duration: Duration.Duration): string => {
  const total = Duration.toMinutes(duration);
  const whole = Math.floor(total / 60);
  const minutes = total % 60;
  return `${whole} hour${whole === 1 ? "" : "s"}${minutes === 0 ? "" : ` ${minutes} minutes`}`;
};

/** docs/event-formats.md: every format, as the module has it. */
export function formatsDoc(): string {
  const sections = programs.map((program) => {
    const format = formats[program];
    const needs = [
      ...(format.talksRequired ? ["talks, each with its speakers"] : []),
      ...(format.scheduleRequired ? ["a schedule on its page"] : []),
      ...(format.rules.length > 0
        ? ["a description that carries each of its rules, word for word"]
        : []),
    ];
    const rules = format.rules.map(
      (rule) => `- **${rule.text}** From ${rule.since} on. ${rule.why}`,
    );
    return [
      `## ${format.name}`,
      "",
      format.definition,
      "",
      `- On stage: ${format.stage === "talks" ? "its talks" : format.stage === "open-floor" ? "an open floor, with any demos we know of" : "nothing"}.`,
      `- Runs ${hours(format.duration)}, doors to close${format.allDay ? ", and may run through the day" : ""}.`,
      `- Needs, beyond what every evening needs: ${needs.length === 0 ? "nothing" : needs.join("; ")}.`,
      "",
      "Its schedule starts from:",
      "",
      ...format.schedule.map((step) => `- ${offset(step.at)} ${step.title}`),
      "",
      "Its rules, as everyone who comes is told them:",
      "",
      ...(rules.length === 0 ? ["- None of its own."] : rules),
    ].join("\n");
  });
  return [
    "# Event formats",
    "",
    "<!-- Generated from core/src/formats.ts by `bun run formats:doc` in core. Edit the module, not this file. -->",
    "",
    "What each kind of evening is: its definition, what it needs before it goes out, how long it runs, the schedule it starts from, and the rules everyone who comes is told. The completeness report, readiness, the event page and the promo drafts all read them from core/src/formats.ts. A rule applies to evenings that start on or after its day.",
    "",
    ...sections.flatMap((section) => [section, ""]),
  ].join("\n");
}
