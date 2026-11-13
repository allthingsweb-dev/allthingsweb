import type { TalkToCoach } from "./client.ts";
import { commandName } from "./config.ts";
import { CliError, ExitCode } from "./errors.ts";
import {
  coachingLimits,
  goals as knownGoals,
  maxSlotMinutes,
  type Goal,
} from "./schemas.ts";
import { suggest } from "./suggest.ts";

/**
 * `allthings coach`: a talk's files read from disk, as coach_talk takes
 * them. What a file is goes by its extension: Markdown is what you wrote
 * (an outline, or slides split by `---` lines), and .txt, .vtt and .srt
 * are what you said (a rehearsal's transcript). Nothing is read but the
 * files named, and they go only to coach_talk, which keeps none of it.
 */

/** A file as read from disk. */
export interface TalkFile {
  readonly path: string;
  readonly text: string;
}

/** What `coach` was told besides its files. */
export interface CoachOptions {
  readonly slot: string | undefined;
  readonly talk: boolean;
  readonly goals: ReadonlyArray<string>;
  readonly title: string | undefined;
  readonly abstract: string | undefined;
}

/** The longest open-floor slot: one longer is a talk in the lineup. */
export const longestOpenFloor = 5;

/** A slot's minutes when none is given: an open floor's, or a talk's. */
export const defaultMinutes = { "open-floor": 3, talk: 20 } as const;

type Part = "outline" | "transcript";

/** Each extension coach reads, and the part of a talk it is. */
const extensions: Readonly<Record<string, Part>> = {
  md: "outline",
  markdown: "outline",
  txt: "transcript",
  vtt: "transcript",
  srt: "transcript",
};

/** Which part of a talk a file is, by its extension. */
export function partOf(path: string): Part | undefined {
  const extension = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  return Object.hasOwn(extensions, extension)
    ? extensions[extension]
    : undefined;
}

const what: Readonly<Record<Part, string>> = {
  outline: "an outline or slides",
  transcript: "a transcript",
};

function usage(message: string): never {
  throw new CliError(
    `${message}\nRun "${commandName} coach --help" for usage.`,
    ExitCode.UsageError,
  );
}

/** The slot's minutes, a whole number from 1 to {@link maxSlotMinutes}. */
function minutesOf(slot: string): number {
  const minutes = Number(slot);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > maxSlotMinutes) {
    usage(
      `--slot must be a whole number of minutes from 1 to ${maxSlotMinutes}.`,
    );
  }
  return minutes;
}

function goalOf(name: string): Goal {
  const goal = knownGoals.find((known) => known === name);
  if (goal !== undefined) return goal;
  const nearest = suggest(name, knownGoals);
  return usage(
    nearest === undefined
      ? `"${name}" isn't a goal. Goals: ${knownGoals.join(", ")}.`
      : `"${name}" isn't a goal. Did you mean "${nearest}"?`,
  );
}

/** A text's length against its limit, or a usage error saying so. */
function within(text: string, limit: number, name: string, part: string) {
  if (text.length > limit) {
    usage(
      `${name} has ${text.length.toLocaleString("en-US")} characters; coach takes ${part} of up to ${limit.toLocaleString("en-US")}. Trim it, or send part of it.`,
    );
  }
}

/** The outline's first Markdown heading, which a deck's title usually is. */
export function headingOf(outline: string): string | undefined {
  const heading = /^#{1,2}[ \t]+(.+?)[ \t#]*$/m.exec(outline)?.[1]?.trim();
  return heading === undefined || heading === "" ? undefined : heading;
}

/** The talk `files` and `options` describe, as coach_talk takes it. */
export function talkToCoach(
  files: ReadonlyArray<TalkFile>,
  options: CoachOptions,
): TalkToCoach {
  if (
    files.length === 0 &&
    options.title === undefined &&
    options.abstract === undefined
  ) {
    usage(
      `"coach" takes your talk's files: .md for an outline or slides, and .txt, .vtt or .srt for a rehearsal's transcript.`,
    );
  }
  const parts: Partial<Record<Part, TalkFile>> = {};
  for (const file of files) {
    const part = partOf(file.path);
    if (part === undefined) {
      usage(
        `${file.path} isn't a file coach reads: .md for an outline or slides, and .txt, .vtt or .srt for a transcript.`,
      );
    }
    const other = parts[part];
    if (other !== undefined) {
      usage(
        `Send one file of ${what[part]}: ${other.path} and ${file.path} both are.`,
      );
    }
    parts[part] = file;
  }
  const minutes =
    options.slot === undefined ? undefined : minutesOf(options.slot);
  const format =
    options.talk || (minutes !== undefined && minutes > longestOpenFloor)
      ? "talk"
      : "open-floor";
  const outline = parts.outline?.text.trim() ?? "";
  const transcript = parts.transcript?.text.trim() ?? "";
  const title = (options.title ?? headingOf(outline))?.trim();
  const abstract = options.abstract?.trim();
  if (parts.outline !== undefined) {
    within(outline, coachingLimits.outline, parts.outline.path, "an outline");
  }
  if (parts.transcript !== undefined) {
    within(
      transcript,
      coachingLimits.transcript,
      parts.transcript.path,
      "a transcript",
    );
  }
  if (title !== undefined) {
    within(title, coachingLimits.title, "The title", "a title");
  }
  if (abstract !== undefined) {
    within(abstract, coachingLimits.abstract, "The abstract", "an abstract");
  }
  const goals = [...new Set(options.goals.map(goalOf))];
  return {
    format,
    minutes: minutes ?? defaultMinutes[format],
    ...(title === undefined || title === "" ? {} : { title }),
    ...(abstract === undefined || abstract === "" ? {} : { abstract }),
    ...(outline === "" ? {} : { outline }),
    ...(transcript === "" ? {} : { transcript }),
    ...(goals.length === 0 ? {} : { goals }),
  };
}
