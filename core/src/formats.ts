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

/**
 * How big an evening of a format is. Lengths are defaults, not rules:
 * readiness advises when an evening departs from its size's.
 */
export interface Size {
  /** As copy names it, lowercase. */
  readonly name: string;
  /** What sets it apart, for the doc. */
  readonly definition: string;
  /** How long it runs, doors to close, unless planned otherwise. */
  readonly duration: Duration.Duration;
  /**
   * The longest an evening of this size runs, doors to close: one longer
   * is the next size. Null for the largest.
   */
  readonly upTo: Duration.Duration | null;
  /**
   * Whether it may start before 4 PM and run past the longest evening
   * without advice: only a full-day hackathon runs through the day.
   */
  readonly allDay: boolean;
  /**
   * What an organizer is asked to confirm before choosing it, as advice:
   * a size that is only worth it when it's a big deal. Null when none.
   */
  readonly confirm: string | null;
  /** The schedule a new one starts from. */
  readonly schedule: ReadonlyArray<ScheduleStep>;
}

/**
 * The at/hack starter a hackathon's teams start from
 * (github.com/allthingsweb-dev/hack), once a version is published: then
 * its rules say which.
 */
export interface Starter {
  readonly name: string;
  readonly repository: string;
  /** Its published version, such as "1.0.0"; null until there is one. */
  readonly version: string | null;
  /** The first San Francisco day a version is asked for (YYYY-MM-DD). */
  readonly since: string | null;
}

export interface Format {
  readonly program: EventProgram;
  /** As copy names it, lowercase. */
  readonly name: string;
  /** One of them, as a sentence says it: "an evening of talks". */
  readonly one: string;
  /** What the evening is, in a sentence or two. */
  readonly definition: string;
  /**
   * What its page shows on stage: its talks, an open floor (with any demos
   * we know of), or nothing.
   */
  readonly stage: "talks" | "open-floor" | null;
  /** Whether a complete record of it has talks. */
  readonly talksRequired: boolean;
  /** Whether its page needs a schedule before it goes out. */
  readonly scheduleRequired: boolean;
  /**
   * Its sizes, the default first, each up to a longer length than the one
   * before it; an evening's length says which it is ({@link sizeOf}).
   */
  readonly sizes: readonly [Size, ...ReadonlyArray<Size>];
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

/**
 * How a hackathon's projects are judged: what works, before what looks
 * good. Judging audits each project, so a demo alone wins nothing.
 */
export const judgingCriteria: PublicRule = {
  id: "judging",
  text: "Projects are judged on whether they work before how they look, then on how useful and how creative they are: judges run each project and its tests, and read its code and CodeRabbit's review.",
  why: "A vibe-coded demo can look finished and not work. Auditing every project (does it run, do its tests pass, what CodeRabbit and its code say) tells the working, useful and creative ones from the rest.",
  since: "2026-10-06",
};

/**
 * The at/hack starter: its repository and the version teams start from,
 * in this one value. Publishing a new version means changing it here.
 */
export const hackStarter: Starter = {
  name: "at/hack",
  repository: "https://github.com/allthingsweb-dev/hack",
  version: "1.0.0",
  since: "2026-10-06",
};

/**
 * The rule that asks teams to start from a published at/hack version, or
 * none while there is no version.
 */
export function starterRule(starter: Starter): PublicRule | null {
  if (starter.version === null || starter.since === null) return null;
  return {
    id: "starter",
    text: `Start from ${starter.name} v${starter.version} (${starter.repository}), or include its files.`,
    why: "Every project starts from the same files, so judges can run and audit each one the same way.",
    since: starter.since,
  };
}

/** A hackathon's rules: open source, how it's judged, and the starter once published. */
export const hackathonRules = (starter: Starter): ReadonlyArray<PublicRule> => {
  const fromStarter = starterRule(starter);
  return [
    openSourceProjects,
    judgingCriteria,
    ...(fromStarter === null ? [] : [fromStarter]),
  ];
};

/** An evening's one size: 3 hours, doors to close. */
const evening = (schedule: ReadonlyArray<ScheduleStep>): Size => ({
  name: "evening",
  definition: "An evening, doors to close.",
  duration: Duration.hours(3),
  upTo: null,
  allDay: false,
  confirm: null,
  schedule,
});

export const formats: Readonly<Record<EventProgram, Format>> = {
  talks: {
    program: "talks",
    name: "talks",
    one: "an evening of talks",
    definition:
      "A lineup on stage: talks, panels and fireside chats, with time before and after to meet people.",
    stage: "talks",
    talksRequired: true,
    scheduleRequired: false,
    sizes: [
      evening([
        { at: 0, title: "Doors open: food, drinks and people" },
        { at: 45, title: "On stage" },
        { at: 135, title: "Time to talk, until close" },
      ]),
    ],
    rules: [],
  },
  "open-floor": {
    program: "open-floor",
    name: "open floor",
    one: "an open floor",
    definition: "No lineup: anyone can get up and show what they're building.",
    stage: "open-floor",
    talksRequired: false,
    scheduleRequired: false,
    sizes: [
      evening([
        { at: 0, title: "Doors open: food, drinks and people" },
        { at: 45, title: "Open floor: anyone can show what they're building" },
        { at: 135, title: "Time to talk, until close" },
      ]),
    ],
    rules: [],
  },
  social: {
    program: "social",
    name: "social evening",
    one: "a social evening",
    definition:
      "No stage: an evening to meet people over food and drinks, sometimes around a game such as trivia.",
    stage: null,
    talksRequired: false,
    scheduleRequired: false,
    sizes: [evening([{ at: 0, title: "Doors open: food, drinks and people" }])],
    rules: [],
  },
  hackathon: {
    program: "hackathon",
    name: "hackathon",
    one: "a hackathon",
    definition:
      "Teams build something in a set time, then show it, and judges pick the winners after auditing every project.",
    stage: null,
    talksRequired: false,
    scheduleRequired: true,
    sizes: [
      {
        name: "lightning",
        definition:
          "The usual: an evening, with 90 minutes to 2 hours of hacking.",
        duration: Duration.hours(3),
        upTo: Duration.hours(4),
        allDay: false,
        confirm: null,
        schedule: [
          { at: 0, title: "Doors open: food, drinks and forming teams" },
          {
            at: 15,
            title: "Kickoff: the theme, the rules and how judging works",
          },
          { at: 25, title: "Hacking" },
          {
            at: 125,
            title: "Submissions close: each team's public repository",
          },
          {
            at: 130,
            title:
              "Judging: judges run and audit every project, while everyone eats and shows their project at an open demo table",
          },
          { at: 165, title: "Awards" },
        ],
      },
      {
        name: "full-day",
        definition:
          "A whole day of hacking: only worth it when it's a big deal, otherwise it's long and drawn out.",
        duration: Duration.hours(8),
        upTo: null,
        allDay: true,
        confirm:
          "A full-day hackathon should be a big deal, or it drags: confirm it's meant to run all day, not as a lightning one.",
        schedule: [
          { at: 0, title: "Doors open: breakfast and forming teams" },
          {
            at: 30,
            title: "Kickoff: the theme, the rules and how judging works",
          },
          { at: 60, title: "Hacking, with lunch" },
          {
            at: 330,
            title: "Submissions close: each team's public repository",
          },
          {
            at: 345,
            title:
              "Judging: judges run and audit every project, while everyone eats and watches lightning talks and open demos",
          },
          { at: 435, title: "Finalists demo" },
          { at: 465, title: "Awards" },
        ],
      },
    ],
    rules: hackathonRules(hackStarter),
  },
};

/** One of `size`, as a sentence says it: "a lightning hackathon". */
export const sizeLabel = (format: Format, size: Size): string =>
  format.sizes.length > 1 ? `a ${size.name} ${format.name}` : format.one;

/**
 * The size of a `format` evening that runs `length`: the first whose
 * longest is at least as long, else the largest.
 */
export function sizeOf(format: Format, length: Duration.Duration): Size {
  return (
    format.sizes.find(
      (size) =>
        size.upTo === null || Duration.isLessThanOrEqualTo(length, size.upTo),
    ) ?? format.sizes[0]
  );
}

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

/** The schedule a new evening of `size` starts from, a line a step. */
export const scheduleLines = (size: Size): ReadonlyArray<string> =>
  size.schedule.map((step) => `${offset(step.at)} ${step.title}`);

/** "3 hours", "1 hour 30 minutes": a length as copy says it. */
export const hours = (duration: Duration.Duration): string => {
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
    const several = format.sizes.length > 1;
    const sizes = format.sizes.flatMap((size, index) => [
      several
        ? `### ${size.name}${index === 0 ? " (the default)" : ""}`
        : "### Length and schedule",
      "",
      ...(several ? [size.definition, ""] : []),
      `- Runs ${hours(size.duration)} by default, doors to close${size.upTo === null ? "" : `, up to ${hours(size.upTo)}`}${size.allDay ? ", and may run through the day" : ""}. Another length is advised on, never refused.`,
      ...(size.confirm === null
        ? []
        : [`- Readiness asks to confirm it: "${size.confirm}"`]),
      "",
      "Its schedule starts from:",
      "",
      ...size.schedule.map((step) => `- ${offset(step.at)} ${step.title}`),
      "",
    ]);
    return [
      `## ${format.name}`,
      "",
      format.definition,
      "",
      `- On stage: ${format.stage === "talks" ? "its talks" : format.stage === "open-floor" ? "an open floor, with any demos we know of" : "nothing"}.`,
      `- Needs, beyond what every evening needs: ${needs.length === 0 ? "nothing" : needs.join("; ")}.`,
      "",
      ...sizes,
      "### Rules",
      "",
      "As everyone who comes is told them:",
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
