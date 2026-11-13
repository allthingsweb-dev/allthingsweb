import { Schema } from "effect";

/**
 * Coaching for a talk at allthings: a speaker sends what they have (the
 * slot, a title, an abstract, an outline or slide text, a rehearsal's
 * transcript, what they want from the talk) and gets back what to change
 * before they're on stage, each point with what was measured and one line
 * of advice. Every check is a pure function of what was sent: the same
 * materials always get the same coaching, and nothing is kept.
 *
 * The rules come from how our evenings run:
 *
 * - The about page (web/src/pages/about.tsx): "Show what you built and
 *   how. A talk earns its place by what the room takes home, not by who
 *   gives it."
 * - The code of conduct (web/src/pages/code-of-conduct.tsx): "Share useful
 *   work and honest lessons. No shilling, sales pitches, or pressure to
 *   buy, invest, or hand over contact details." get_community says the same
 *   (web/src/mcp/community.ts).
 * - The open floor (src/formats.ts): "anyone can get up and show what
 *   they're building". At allthings/aie (Nov 11, 2026) each open-floor
 *   talk had 3 minutes, timed from the speaker's first words; at exactly
 *   3:00 the room's screen switched to the timer, cutting the speaker's
 *   AirPlay, and a live demo was ended there. A no-shilling watch let
 *   self-introductions, open-source plugs and free packages pass, and
 *   flagged the one talk that turned into a pitch. The venue's Wi-Fi kept
 *   devices from reaching each other.
 * - The talks library (allthings.dev/talks): every talk is listed by its
 *   title, with its recording and what the speaker shares.
 *
 * The /coach page, the `coach_talk` MCP tool and `allthings coach` all read
 * {@link rules} and {@link coach}; nothing else states a coaching rule.
 */

/** How a talk is held: an open-floor slot, or a talk in an evening's lineup. */
export const SlotFormat = Schema.Literals(["open-floor", "talk"]).annotate({
  description:
    "open-floor: a short slot anyone can take at an open floor. talk: a talk in an evening's lineup.",
});
export type SlotFormat = typeof SlotFormat.Type;

/** The longest slot coaching takes, in minutes. */
export const maxSlotMinutes = 60;

export const Slot = Schema.Struct({
  format: SlotFormat,
  minutes: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: maxSlotMinutes }),
  ).annotate({ description: "How long the slot is, in whole minutes." }),
});
export type Slot = typeof Slot.Type;

/**
 * A slot's length when the speaker doesn't say: the open floor's 3 minutes
 * (allthings/aie), and 20 for a talk, the share of an evening's 90 minutes
 * on stage (src/formats.ts) that a lineup of four gets.
 */
export const defaultMinutes: Readonly<Record<SlotFormat, number>> = {
  "open-floor": 3,
  talk: 20,
};

/** What a speaker can want from a talk. None of them is a sale. */
export const Goal = Schema.Literals([
  "first-talk",
  "teach-a-technique",
  "find-contributors",
  "show-a-launch",
  "get-hired",
]);
export type Goal = typeof Goal.Type;

/** The longest each part of the materials may be, in characters. */
export const limits = {
  title: 200,
  abstract: 3_000,
  outline: 20_000,
  /** About 30 minutes of WebVTT. */
  transcript: 60_000,
  goals: 5,
} as const;

const bounded = (max: number, description: string) =>
  Schema.String.check(Schema.isMaxLength(max)).annotate({ description });

/** What a speaker sends to be coached. Only the slot is required. */
export const TalkMaterials = Schema.Struct({
  slot: Slot,
  title: Schema.optionalKey(bounded(limits.title, "The talk's title.")),
  abstract: Schema.optionalKey(
    bounded(limits.abstract, "The talk's abstract, as people will read it."),
  ),
  outline: Schema.optionalKey(
    bounded(
      limits.outline,
      "An outline or the slides' text. Slides separated by lines of --- are counted as slides.",
    ),
  ),
  transcript: Schema.optionalKey(
    bounded(
      limits.transcript,
      "A rehearsal's transcript: plain text, or WebVTT or SRT with timestamps.",
    ),
  ),
  goals: Schema.optionalKey(
    Schema.Array(Goal).check(Schema.isMaxLength(limits.goals)),
  ),
});
export type TalkMaterials = typeof TalkMaterials.Type;

/** How much a finding matters before the talk. */
export const Severity = Schema.Literals(["must", "should", "consider"]);
export type Severity = typeof Severity.Type;

/** Most pressing first. */
export const severities: ReadonlyArray<Severity> = [
  "must",
  "should",
  "consider",
];

export const Finding = Schema.Struct({
  id: Schema.String,
  severity: Severity,
  /** What was measured, with its numbers. */
  observed: Schema.String,
  /** One line of what to do about it. */
  advice: Schema.String,
});
export type Finding = typeof Finding.Type;

/** A check the materials passed, and what it saw. */
export const Strength = Schema.Struct({
  id: Schema.String,
  observed: Schema.String,
});
export type Strength = typeof Strength.Type;

/** A check that couldn't run, and what it needs. */
export const Unchecked = Schema.Struct({
  id: Schema.String,
  needs: Schema.String,
});
export type Unchecked = typeof Unchecked.Type;

/** The numbers the checks read, null where nothing measured them. */
export const Measures = Schema.Struct({
  /** Words in the transcript. */
  words: Schema.NullOr(Schema.Int),
  /** Whether the transcript had timestamps (WebVTT or SRT). */
  timed: Schema.Boolean,
  /** Spoken length, from the timestamps or estimated from the words. */
  seconds: Schema.NullOr(Schema.Int),
  wordsPerMinute: Schema.NullOr(Schema.Int),
  fillersPerMinute: Schema.NullOr(Schema.Number),
  /** Slides in the outline, when it is split into slides. */
  slides: Schema.NullOr(Schema.Int),
  mostWordsOnASlide: Schema.NullOr(Schema.Int),
});
export type Measures = typeof Measures.Type;

export const Coaching = Schema.Struct({
  slot: Slot,
  goals: Schema.Array(Goal),
  measures: Measures,
  /** Most pressing first, then in the order of {@link rules}. */
  findings: Schema.Array(Finding),
  strengths: Schema.Array(Strength),
  unchecked: Schema.Array(Unchecked),
  /** What to do first, in a few lines. */
  summary: Schema.Array(Schema.String),
});
export type Coaching = typeof Coaching.Type;

// ---------------------------------------------------------------------------
// Reading the materials

/** The pace a transcript without timestamps is read at, in words a minute. */
export const spokenWordsPerMinute = 150;

/** How long the opening is: the time to say who you are and what you built. */
export const openingSeconds = 20;

/** One timed line of a WebVTT or SRT transcript, in seconds. */
export interface Cue {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** A transcript as the checks read it. */
export interface Spoken {
  /** Every cue, in order, when it had timestamps; null for plain text. */
  readonly cues: ReadonlyArray<Cue> | null;
  /** The words, without timestamps, cue numbers or markup. */
  readonly text: string;
}

const timing =
  /^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/;

/** "01:02:03.500", "02:03,5" or "2:03.500" in seconds. */
const seconds = (stamp: string): number => {
  const [time = "", fraction = "0"] = stamp.split(/[.,]/);
  const parts = time.split(":").map(Number);
  const whole = parts.reduce((total, part) => total * 60 + part, 0);
  return whole + Number(`0.${fraction}`);
};

/**
 * A transcript, plain or timed. WebVTT and SRT are told apart from plain
 * text by their `-->` timing lines: their headers, notes, cue numbers and
 * voice tags are dropped, and each cue keeps its start, end and words.
 */
export function readTranscript(raw: string): Spoken {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  if (!lines.some((line) => timing.test(line))) {
    return { cues: null, text: raw.replace(/\s+/g, " ").trim() };
  }
  const cues: Array<Cue> = [];
  let current: { start: number; end: number; lines: Array<string> } | null =
    null;
  const close = () => {
    if (current === null) return;
    const words = current.lines
      .join(" ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (words !== "") {
      cues.push({ start: current.start, end: current.end, text: words });
    }
    current = null;
  };
  for (const line of lines) {
    const match = timing.exec(line);
    if (match !== null) {
      close();
      current = {
        start: seconds(match[1] ?? ""),
        end: seconds(match[2] ?? ""),
        lines: [],
      };
    } else if (line.trim() === "") {
      close();
    } else if (current !== null) {
      current.lines.push(line);
    }
  }
  close();
  return { cues, text: cues.map((cue) => cue.text).join(" ") };
}

/** The words of `text`, as they are counted. */
export const wordsOf = (text: string): ReadonlyArray<string> =>
  text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? [];

/**
 * An outline's slides: its parts between lines of `---` (Markdown slide
 * decks such as Slidev's, Marp's and reveal.js's), a front matter block
 * aside. Null when it isn't split into slides: an outline, not a deck.
 */
export function slidesOf(outline: string): ReadonlyArray<string> | null {
  const body = outline
    .replace(/\r\n?/g, "\n")
    .replace(/^---\n[\s\S]*?\n---\n/, "");
  const slides = body
    .split(/^\s*---+\s*$/m)
    .map((slide) => slide.trim())
    .filter((slide) => slide !== "");
  return /^\s*---+\s*$/m.test(body) && slides.length > 1 ? slides : null;
}

/** What the checks read: the materials, read once. */
export interface Talk {
  readonly slot: Slot;
  readonly goals: ReadonlyArray<Goal>;
  readonly title: string;
  readonly abstract: string;
  readonly outline: string;
  readonly slides: ReadonlyArray<string> | null;
  readonly spoken: Spoken | null;
  /** The transcript's words. */
  readonly words: number;
  /** Spoken length in seconds, measured or estimated; null without a transcript. */
  readonly seconds: number | null;
}

export function readTalk(materials: TalkMaterials): Talk {
  const transcript = materials.transcript?.trim() ?? "";
  const spoken = transcript === "" ? null : readTranscript(transcript);
  const words = spoken === null ? 0 : wordsOf(spoken.text).length;
  const cues = spoken?.cues ?? null;
  const first = cues?.[0];
  const last = cues?.at(-1);
  const length =
    spoken === null || words === 0
      ? null
      : first !== undefined && last !== undefined
        ? Math.max(0, last.end - first.start)
        : (words / spokenWordsPerMinute) * 60;
  const outline = materials.outline?.trim() ?? "";
  return {
    slot: materials.slot,
    goals: [...new Set(materials.goals ?? [])],
    title: materials.title?.trim() ?? "",
    abstract: materials.abstract?.trim() ?? "",
    outline,
    slides: slidesOf(outline),
    spoken: words === 0 ? null : spoken,
    words,
    seconds: length === null ? null : Math.round(length),
  };
}

/** Whether the talk's transcript had timestamps. */
export const isTimed = (talk: Talk): boolean =>
  talk.spoken !== null && talk.spoken.cues !== null;

/** The talk's first `openingSeconds`: its transcript's, else its outline's. */
export function openingOf(talk: Talk): string {
  const { spoken } = talk;
  if (spoken !== null) {
    const first = spoken.cues?.[0];
    if (spoken.cues !== null && first !== undefined) {
      return spoken.cues
        .filter((cue) => cue.start - first.start < openingSeconds)
        .map((cue) => cue.text)
        .join(" ");
    }
    return firstWords(spoken.text, openingWords);
  }
  return firstWords(talk.slides?.[0] ?? talk.outline, openingWords);
}

/** The words said in {@link openingSeconds} at the usual pace. */
const openingWords = Math.round((spokenWordsPerMinute * openingSeconds) / 60);

/** How much of the end is read for where to find the work. */
const closingWords = 60;

/** The talk's end: its transcript's last words, else its last slide or lines. */
export function closingOf(talk: Talk): string {
  if (talk.spoken !== null) return lastWords(talk.spoken.text, closingWords);
  return talk.slides?.at(-1) ?? lastWords(talk.outline, closingWords);
}

const firstWords = (text: string, count: number): string =>
  text.split(/\s+/).slice(0, count).join(" ");

const lastWords = (text: string, count: number): string =>
  text.split(/\s+/).slice(-count).join(" ");

/** Everything the speaker wrote or said, for checks that read it all. */
const everything = (talk: Talk): string =>
  [talk.title, talk.abstract, talk.outline, talk.spoken?.text ?? ""].join("\n");

/** What the speaker plans to show: their outline and what they said. */
const plan = (talk: Talk): string =>
  [talk.abstract, talk.outline, talk.spoken?.text ?? ""].join("\n");

/** "2:05" for 125 seconds. */
export const clock = (total: number): string => {
  const whole = Math.round(total);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/** A phrase the checks found, in lowercase, and how many times. */
interface Found {
  readonly phrase: string;
  readonly count: number;
}

/** What `patterns` match in `text`, most often first, then alphabetically. */
function phrases(
  text: string,
  patterns: ReadonlyArray<RegExp>,
): ReadonlyArray<Found> {
  const counts = new Map<string, number>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(new RegExp(pattern.source, "giu"))) {
      const phrase = match[0].toLowerCase().replace(/\s+/g, " ");
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([phrase, count]) => ({ phrase, count }))
    .toSorted((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase));
}

/** `"book a demo" ×2`: a found phrase as an observation quotes it. */
const quoted = ({ phrase, count }: Found): string =>
  count > 1 ? `"${phrase}" ×${count}` : `"${phrase}"`;

const some = (text: string, patterns: ReadonlyArray<RegExp>): boolean =>
  patterns.some((pattern) => new RegExp(pattern.source, "iu").test(text));

// ---------------------------------------------------------------------------
// The rules

/** What a check needs before it can run, and how to ask for it. */
export const needs = {
  nothing: "",
  transcript: "a rehearsal's transcript",
  timedTranscript: "a transcript with timestamps (WebVTT or SRT)",
  words: "an outline, slides or a rehearsal's transcript",
  slides: "slides, separated by lines of ---",
} as const;
export type Need = keyof typeof needs;

/** A check's verdict on what it read. */
export type Verdict =
  | { readonly pass: true; readonly observed: string }
  | {
      readonly pass: false;
      readonly severity: Severity;
      readonly observed: string;
      readonly advice: string;
    };

const pass = (observed: string): Verdict => ({ pass: true, observed });

const flag = (
  severity: Severity,
  observed: string,
  advice: string,
): Verdict => ({ pass: false, severity, observed, advice });

export interface Rule {
  readonly id: string;
  /** The goal it coaches for; every talk is checked against the rest. */
  readonly goal: Goal | null;
  /** What good looks like, as /coach says it. */
  readonly good: string;
  /** Why, from how our evenings run. */
  readonly why: string;
  readonly needs: Need;
  /** Its verdict, or null when it doesn't apply to this talk. */
  readonly check: (talk: Talk) => Verdict | null;
}

/** How far into a slot to aim to finish: 90%, on a 5-second mark. */
export const finishBy = (slot: Slot): number =>
  Math.floor((slot.minutes * 60 * 0.9) / 5) * 5;

const length: Rule = {
  id: "length",
  goal: null,
  good: "Finish with room to spare: by 2:40 of a 3-minute slot, by 90% of a longer one.",
  why: "The timer starts at your first words, and the slot ends on time. At allthings/aie the screen switched to the timer at exactly 3:00, and a live demo ended there.",
  needs: "transcript",
  check: (talk) => {
    if (talk.seconds === null || talk.spoken === null) return null;
    const slot = talk.slot.minutes * 60;
    const target = finishBy(talk.slot);
    const runs =
      talk.spoken.cues === null
        ? `About ${clock(talk.seconds)} at ${spokenWordsPerMinute} words a minute (${talk.words} words)`
        : `Your rehearsal runs ${clock(talk.seconds)}`;
    const observed = `${runs}, in a ${clock(slot)} slot.`;
    if (talk.seconds > slot) {
      return flag(
        "must",
        observed,
        talk.slot.format === "open-floor"
          ? `Cut ${clock(talk.seconds - target)} to finish by ${clock(target)}. At ${clock(slot)} the screen goes to the timer, mid-sentence or mid-demo.`
          : `Cut ${clock(talk.seconds - target)} to finish by ${clock(target)}. The slot ends on time, and the next speaker is waiting.`,
      );
    }
    if (talk.seconds > target) {
      return flag(
        "should",
        observed,
        `Aim to finish by ${clock(target)}: a laugh, a question or a slow demo will use the rest.`,
      );
    }
    if (talk.seconds < slot / 2) {
      return flag(
        "consider",
        observed,
        `You have ${clock(slot - talk.seconds)} to spare. Show one more thing, or keep it short: short is fine.`,
      );
    }
    return pass(observed);
  },
};

/** The pace past which a room stops following, in words a minute. */
export const fastPace = 175;
/** The pace under which a talk drags, unless a demo is doing the talking. */
export const slowPace = 100;

const pace: Rule = {
  id: "pace",
  goal: null,
  good: `Speak at a pace the room can follow: between ${slowPace} and ${fastPace} words a minute.`,
  why: "The room hears it once. Racing to fit a hard timer loses them; cutting words keeps them.",
  needs: "timedTranscript",
  check: (talk) => {
    if (!isTimed(talk) || talk.seconds === null) return null;
    if (talk.seconds < 30) return null;
    const wpm = Math.round(talk.words / (talk.seconds / 60));
    const observed = `${wpm} words a minute.`;
    if (wpm > fastPace) {
      return flag(
        "should",
        observed,
        "Slow down. Cut words rather than breaths: the room is hearing it for the first time.",
      );
    }
    if (wpm < slowPace) {
      return flag(
        "consider",
        observed,
        "That's slow, unless a demo is doing the talking. If it isn't, you have room for more.",
      );
    }
    return pass(observed);
  },
};

const introduces = [
  /\bi'?m\b/,
  /\bi am\b/,
  /\bmy name(?:'s| is)\b/,
  /\bi (?:work|lead|maintain|run)\b/,
  /\bwe(?:'re| are)\b/,
];

const built = [
  /\b(?:built|build|building|made|wrote|writing|created|shipped|shipping|launched|maintain|maintaining)\b/,
  /\bworking on\b/,
];

const opening: Rule = {
  id: "opening",
  goal: null,
  good: `Open with who you are and what you built, in your first ${openingSeconds} seconds.`,
  why: 'allthings is about who\'s on stage and what they built: "Show what you built and how." Saying it first tells the room why to listen.',
  needs: "words",
  check: (talk) => {
    const start = openingOf(talk).replace(/’/g, "'");
    const who = some(start, introduces);
    const what = some(start, built);
    const where =
      talk.spoken === null
        ? "Your outline's opening"
        : `Your first ${openingSeconds} seconds`;
    if (who && what) {
      return pass(`${where} say who you are and what you built.`);
    }
    const missing =
      !who && !what
        ? "who you are or what you built"
        : who
          ? "what you built"
          : "who you are";
    return flag(
      !who && !what ? "should" : "consider",
      `${where} don't say ${missing}.`,
      `Start with one line: "I'm <name>, and I built <thing>." Then show it.`,
    );
  },
};

/** Asking for money, a meeting with sales or someone's details. */
const hardSell = [
  /\$\s?\d[\d,.]*\s*(?:\/|per\s+)(?:mo|month|year|yr|seat|user)\b/,
  /\b\d{1,2}\s?% off\b/,
  /\bdiscounts?\b/,
  /\bpromo code\b/,
  /\bcoupons?\b/,
  /\b(?:book|schedule|request|get) a demo\b/,
  /\b(?:talk|speak) (?:to|with) (?:our )?sales\b/,
  /\bcontact (?:our )?sales\b/,
  /\bbuy (?:it )?now\b/,
  /\blimited[- ]time\b/,
  /\bfree trial\b/,
  /\b(?:leave|drop|give|share|send) (?:me |us )?your (?:email|e-mail|phone|number|contact)\b/,
];

/** Selling, more softly: plans, sign-ups, waitlists, a round. */
const softSell = [
  /\bpricing (?:page|plans?|tiers?)\b/,
  /\bour pricing\b/,
  /\bplans start at\b/,
  /\benterprise (?:plan|tier)\b/,
  /\bsign up (?:today|now|for free|for (?:our|the) (?:beta|waitlist|early access))\b/,
  /\bjoin (?:our|the) wait ?list\b/,
  /\b(?:we're|we are) raising\b/,
];

const noPitch: Rule = {
  id: "no-pitch",
  goal: null,
  good: "Show the work, not a sale: no prices, discounts, demos to book or sign-ups. Saying where you work, open source and free packages are all welcome.",
  why: "We have never sold a stage. The code of conduct says it: no shilling, sales pitches, or pressure to buy, invest, or hand over contact details. At allthings/aie the one talk that turned into a pitch was flagged on the room's screen.",
  needs: "nothing",
  check: (talk) => {
    const all = everything(talk).replace(/’/g, "'");
    if (all.trim() === "") return null;
    const hard = phrases(all, hardSell);
    const soft = phrases(all, softSell);
    if (hard.length === 0 && soft.length === 0) {
      return pass("Nothing to buy, book or sign up for.");
    }
    const found = [...hard, ...soft].slice(0, 5).map(quoted);
    return flag(
      hard.length > 0 ? "must" : "should",
      `Reads as a pitch: ${found.join(", ")}.`,
      "Take those out and show how it works instead. Where you work, open source and free packages are fine to mention.",
    );
  },
};

const demos = [
  /\bdemo(?:s|ing)?\b/,
  /\blive[- ]cod(?:e|ing)\b/,
  /\blet me show you\b/,
  /\bswitch(?:ing)? (?:over )?to my (?:screen|laptop|terminal)\b/,
];

const fallbacks = [
  /\brecord(?:ed|ing)\b/,
  /\bvideo\b/,
  /\bbackup\b/,
  /\bfallback\b/,
  /\bscreen ?(?:cap(?:ture)?|recording)\b/,
  /\bscreenshots?\b/,
  /\bgif\b/,
];

const demo: Rule = {
  id: "demo",
  goal: null,
  good: "Have a live demo recorded as a fallback, playable offline, and know the moment you'll stop.",
  why: "Venue Wi-Fi can keep devices from reaching each other, as it did at allthings/aie, and the timer doesn't wait for a demo to finish.",
  needs: "words",
  check: (talk) => {
    const text = plan(talk);
    if (!some(text, demos)) return null;
    if (some(text, fallbacks)) {
      return pass(
        "There's a demo, with a recording or screenshots to fall back on.",
      );
    }
    return flag(
      "should",
      "There's a demo, and no recording to fall back on.",
      talk.slot.format === "open-floor"
        ? `Record it working before you come, and know where you'll stop: at ${clock(talk.slot.minutes * 60)} the screen goes to the timer.`
        : "Record it working before you come, ready to play offline, and know where you'll cut it if it runs long.",
    );
  },
};

/** About 30 seconds a slide. */
export const slidesPerMinute = 2;

const slideCount: Rule = {
  id: "slide-count",
  goal: null,
  good: `About ${slidesPerMinute} slides a minute at most: one idea each, long enough to land.`,
  why: "A slide the room can't read before it changes is a slide they missed.",
  needs: "slides",
  check: (talk) => {
    if (talk.slides === null) return null;
    const most = talk.slot.minutes * slidesPerMinute;
    const each = Math.round((talk.slot.minutes * 60) / talk.slides.length);
    const observed = `${talk.slides.length} slides in ${talk.slot.minutes} minutes: ${each} seconds a slide.`;
    if (talk.slides.length <= most) return pass(observed);
    return flag(
      talk.slot.format === "open-floor" ? "should" : "consider",
      observed,
      `Cut to ${most} or fewer: keep the ones that show the thing you built.`,
    );
  },
};

/** The most words a slide carries before the room reads instead of listens. */
export const wordsPerSlide = 40;

const slideWords: Rule = {
  id: "slide-words",
  goal: null,
  good: `Keep each slide under ${wordsPerSlide} words: say it, and show the code or the thing.`,
  why: "When a slide is full of words, the room reads it instead of listening to you.",
  needs: "slides",
  check: (talk) => {
    if (talk.slides === null) return null;
    const counts = talk.slides.map((slide) => wordsOf(slide).length);
    const heavy = counts.flatMap((count, index) =>
      count > wordsPerSlide ? [index + 1] : [],
    );
    const most = Math.max(...counts);
    if (heavy.length === 0) {
      return pass(`The busiest slide has ${most} words.`);
    }
    const which = heavy.slice(0, 5).join(", ");
    return flag(
      "should",
      `${heavy.length === 1 ? "Slide" : "Slides"} ${which}${heavy.length > 5 ? " and more" : ""} carry more than ${wordsPerSlide} words (the most is ${most}).`,
      "Say those words instead of showing them, and put the code, a diagram or the thing itself on screen.",
    );
  },
};

const findIt = [
  /https?:\/\/\S+/,
  /\b[\w-]+\.(?:dev|com|io|sh|org|app|ai|so|xyz|net|gg)\b/,
  /\b(?:github|gitlab|codeberg|npm|jsr|pypi|crates)\b/,
  /\b(?:repo|repository|slides)\b/,
  /(?:^|\s)@\w+/,
];

const whereToFind: Rule = {
  id: "where-to-find",
  goal: null,
  good: "End by saying where to find it: the repo, the slides, a link. Then send them to us for your talk's page on allthings.dev.",
  why: "People look you up after, and every talk's page on allthings.dev carries its recording and what the speaker shares.",
  needs: "words",
  check: (talk) => {
    const end = closingOf(talk);
    const where = talk.spoken === null ? "Your last slide" : "Your ending";
    if (some(end, findIt)) {
      return pass(`${where} says where to find the work.`);
    }
    return flag(
      "should",
      `${where} doesn't say where to find the code or the slides.`,
      "Close with the link to the repo or slides on screen, and send them to the organizers for your talk's page.",
    );
  },
};

const fillerWords = [
  /\bu+m+\b/,
  /\bu+h+\b/,
  /\buhm\b/,
  /\berm\b/,
  /\byou know\b/,
  /\bi mean\b/,
  /\bbasically\b/,
  /\bliterally\b/,
  /\bkind of\b/,
  /\bsort of\b/,
];

/** Fillers a minute past which they get in the way. */
export const manyFillers = 6;
/** Fillers a minute past which they're worth working on. */
export const someFillers = 3;

/** Fillers counted in `talk`, and their rate a minute; null without a transcript. */
export function fillers(talk: Talk): {
  readonly count: number;
  readonly perMinute: number;
  readonly top: string;
} | null {
  if (talk.spoken === null || talk.seconds === null || talk.seconds === 0) {
    return null;
  }
  const found = phrases(talk.spoken.text, fillerWords);
  const count = found.reduce((total, each) => total + each.count, 0);
  const top = found[0];
  return {
    count,
    perMinute: Math.round((count / (talk.seconds / 60)) * 10) / 10,
    top: top === undefined ? "" : `"${top.phrase}"`,
  };
}

const filler: Rule = {
  id: "filler",
  goal: null,
  good: `Fewer than ${someFillers} fillers a minute ("um", "you know", "basically").`,
  why: "A pause sounds sure of itself; a filler sounds unsure. Many transcribers drop fillers, so a count here is a floor.",
  needs: "transcript",
  check: (talk) => {
    const counted = fillers(talk);
    if (counted === null) return null;
    const observed =
      counted.count === 0
        ? "No fillers."
        : `${counted.count} fillers, ${counted.perMinute} a minute; most often ${counted.top}.`;
    if (counted.perMinute > manyFillers) {
      return flag(
        "should",
        observed,
        "Pause instead. Rehearse your first and last 30 seconds until they're word for word.",
      );
    }
    if (counted.perMinute > someFillers) {
      return flag(
        "consider",
        observed,
        "Try a breath where the filler goes; a second of quiet reads as confidence.",
      );
    }
    return pass(observed);
  },
};

/** The most words a title has before it stops reading at a glance. */
export const titleWords = 12;

const title: Rule = {
  id: "title",
  goal: null,
  good: `A plain title of ${titleWords} words or fewer that says what the room will take home.`,
  why: "Every talk is listed by its title on its evening's page and at allthings.dev/talks.",
  needs: "nothing",
  check: (talk) => {
    if (talk.title === "") {
      return flag(
        talk.slot.format === "talk" ? "must" : "consider",
        "No title.",
        "Name it for what the room takes home: the thing you built, or what you learned building it.",
      );
    }
    const count = wordsOf(talk.title).length;
    if (count > titleWords) {
      return flag(
        "consider",
        `The title has ${count} words.`,
        `Cut it to ${titleWords} or fewer; put the rest in the abstract.`,
      );
    }
    return pass(`A ${count}-word title.`);
  },
};

/** The longest an abstract reads well on Luma and the event page. */
export const abstractWords = 150;

const abstract: Rule = {
  id: "abstract",
  goal: null,
  good: `For a talk in the lineup, an abstract of ${abstractWords} words or fewer: what you built, and what the room will learn from it.`,
  why: "People choose an evening from its page and Luma, where each talk's abstract is shown.",
  needs: "nothing",
  check: (talk) => {
    if (talk.slot.format !== "talk") return null;
    if (talk.abstract === "") {
      return flag(
        "should",
        "No abstract.",
        "Write two or three sentences: what you built, and what the room will learn from it.",
      );
    }
    const count = wordsOf(talk.abstract).length;
    if (count > abstractWords) {
      return flag(
        "consider",
        `The abstract has ${count} words.`,
        `Cut it to ${abstractWords} or fewer: the first two sentences are the ones people read.`,
      );
    }
    return pass(`A ${count}-word abstract.`);
  },
};

const firstTalk: Rule = {
  id: "first-talk",
  goal: "first-talk",
  good: "Rehearse out loud, with a timer, and record it: a transcript of one run checks your length, pace and opening.",
  why: "Everyone on our stage gave a first talk somewhere. The run-through is where it gets good.",
  needs: "nothing",
  check: (talk) =>
    talk.spoken === null
      ? flag(
          "should",
          "No rehearsal transcript yet.",
          "Rehearse it out loud with a timer and record it, then send the transcript here.",
        )
      : pass("You've rehearsed it out loud."),
};

const steps = [
  /```/,
  /^\s*\d+[.)]\s/m,
  /\bsteps?\b/,
  /\bfirst\b[\s\S]*\bthen\b/,
];

const teach: Rule = {
  id: "teach-a-technique",
  goal: "teach-a-technique",
  good: "Show the steps or the code in order, and end with the one thing to try tomorrow.",
  why: "A talk earns its place by what the room takes home.",
  needs: "words",
  check: (talk) =>
    some(plan(talk), steps)
      ? pass("It walks through steps or code.")
      : flag(
          "should",
          "No steps or code to follow.",
          "Show the technique as steps or code, in order, so people can do it tomorrow.",
        ),
};

const repository =
  /\b(?:github\.com|gitlab\.com|codeberg\.org)\/[\w.-]+\/[\w.-]+/;

const contributorsRepo: Rule = {
  id: "find-contributors-repo",
  goal: "find-contributors",
  good: "Put the repository's link on screen.",
  why: "Someone who wants to help tonight needs to know where.",
  needs: "words",
  check: (talk) =>
    repository.test(everything(talk))
      ? pass("It links the repository.")
      : flag(
          "should",
          "No repository link.",
          "Show the repository's full link at the end, long enough to photograph.",
        ),
};

const contributorsIssue: Rule = {
  id: "find-contributors-issue",
  goal: "find-contributors",
  good: "Name a good first issue, by number or label.",
  why: "A named issue turns interest into a first pull request.",
  needs: "words",
  check: (talk) =>
    /\bgood first issues?\b|\bfirst issues?\b|\bhelp wanted\b|#\d+\b/i.test(
      everything(talk),
    )
      ? pass("It names where to start.")
      : flag(
          "should",
          "No first issue named.",
          'Name one good first issue, or the "good first issue" label, so someone can start tonight.',
        ),
};

const launch: Rule = {
  id: "show-a-launch",
  goal: "show-a-launch",
  good: "Show the launch working, then how you built it.",
  why: "A launch is welcome on our stage; a sales pitch isn't. Showing it working is what tells them apart.",
  needs: "words",
  check: (talk) =>
    some(plan(talk), demos)
      ? pass("It shows the launch working.")
      : flag(
          "should",
          "No demo of what launched.",
          "Show it working, not a list of features: one real thing, end to end.",
        ),
};

const ownWork = [
  /\bi (?:built|wrote|designed|led|made|shipped|found|fixed|debugged|rewrote|migrated)\b/,
];

const hired: Rule = {
  id: "get-hired",
  goal: "get-hired",
  good: "Say what you did yourself, and how you did it.",
  why: "People remember the person who explains how it works, and find them after.",
  needs: "words",
  check: (talk) =>
    some(plan(talk).replace(/’/g, "'"), ownWork)
      ? pass("It says what you did yourself.")
      : flag(
          "should",
          'It doesn\'t say what you did yourself ("I built", "I fixed").',
          "Say your part in the first person, then show how. End with where to find you, not a résumé.",
        ),
};

/** Every check, in the order findings of one severity are given. */
export const rules: ReadonlyArray<Rule> = [
  length,
  noPitch,
  opening,
  demo,
  whereToFind,
  pace,
  filler,
  slideCount,
  slideWords,
  title,
  abstract,
  firstTalk,
  teach,
  contributorsRepo,
  contributorsIssue,
  launch,
  hired,
];

/** Each goal as a speaker picks it. */
export const goalLabels: Readonly<Record<Goal, string>> = {
  "first-talk": "It's my first talk",
  "teach-a-technique": "Teach a technique",
  "find-contributors": "Find contributors",
  "show-a-launch": "Show a launch",
  "get-hired": "Get hired",
};

/** Whether the talk has what each need asks for. */
const has: Readonly<Record<Need, (talk: Talk) => boolean>> = {
  nothing: () => true,
  transcript: (talk) => talk.spoken !== null,
  timedTranscript: isTimed,
  words: (talk) => talk.spoken !== null || talk.outline !== "",
  slides: (talk) => talk.slides !== null,
};

/** How many findings the summary leads with. */
export const summaryLength = 3;

/**
 * The coaching for `materials`: every rule for every talk, and the rules
 * for the goals it names, in severity order, then the order of
 * {@link rules}.
 */
export function coach(materials: TalkMaterials): Coaching {
  const talk = readTalk(materials);
  const findings: Array<Finding> = [];
  const strengths: Array<Strength> = [];
  const unchecked: Array<Unchecked> = [];
  for (const rule of rules) {
    if (rule.goal !== null && !talk.goals.includes(rule.goal)) continue;
    if (!has[rule.needs](talk)) {
      unchecked.push({ id: rule.id, needs: needs[rule.needs] });
      continue;
    }
    const verdict = rule.check(talk);
    if (verdict === null) continue;
    if (verdict.pass) {
      strengths.push({ id: rule.id, observed: verdict.observed });
    } else {
      findings.push({
        id: rule.id,
        severity: verdict.severity,
        observed: verdict.observed,
        advice: verdict.advice,
      });
    }
  }
  const ordered = findings.toSorted(
    (a, b) => severities.indexOf(a.severity) - severities.indexOf(b.severity),
  );
  const counted = fillers(talk);
  const counts = talk.slides?.map((slide) => wordsOf(slide).length) ?? null;
  return {
    slot: talk.slot,
    goals: talk.goals,
    measures: {
      words: talk.spoken === null ? null : talk.words,
      timed: isTimed(talk),
      seconds: talk.seconds,
      wordsPerMinute:
        talk.seconds === null || talk.seconds === 0
          ? null
          : Math.round(talk.words / (talk.seconds / 60)),
      fillersPerMinute: counted?.perMinute ?? null,
      slides: talk.slides?.length ?? null,
      mostWordsOnASlide: counts === null ? null : Math.max(...counts),
    },
    findings: ordered,
    strengths,
    unchecked,
    summary: summaryOf(ordered, unchecked),
  };
}

/** What to do first: the most pressing findings' advice, or that it's ready. */
function summaryOf(
  findings: ReadonlyArray<Finding>,
  unchecked: ReadonlyArray<Unchecked>,
): ReadonlyArray<string> {
  if (findings.length > 0) {
    return findings.slice(0, summaryLength).map((finding) => finding.advice);
  }
  const more = [...new Set(unchecked.map((check) => check.needs))];
  return [
    "Nothing to change in what you sent. See you on stage.",
    ...(more.length === 0 ? [] : [`Send ${more.join(", or ")} to check more.`]),
  ];
}
