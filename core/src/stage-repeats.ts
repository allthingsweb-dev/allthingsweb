import { namedReferences } from "./html-entities.ts";
import type { SafeHtml } from "./rich-text.ts";

/**
 * An evening's Luma description often repeats what its page already shows
 * on stage: each speaker's bio, each talk's abstract, under a heading such
 * as `"History of React" w/ Tom Occhino`. The page shows the description
 * without those parts, decided at render time from the description and the
 * stage alone; the stored text is never changed.
 *
 * A part is one top-level block of the sanitized description (a paragraph,
 * a list, a heading). It is dropped when it is a repeat: its words, as
 * {@link wordsOf} reads them, are all within a talk's abstract or a
 * speaker's bio, or hold one whole and little else. A short block that
 * names a speaker or a talk is dropped too when the block after it is: it
 * was that repeat's heading. Everything else is kept as it is.
 */

/** What the stage shows, as the description is checked against it. */
export interface Stage {
  readonly talks: ReadonlyArray<{
    readonly title: string;
    readonly description: string | null;
    readonly speakers: ReadonlyArray<{
      readonly name: string;
      readonly bio: string | null;
    }>;
  }>;
}

/** The fewest characters of words a block or a source has to be a repeat. */
export const minimumRepeat = 40;

/**
 * How much of a block one whole source has to fill for the block to be
 * that source and little else.
 */
export const wholeShare = 0.8;

/** The longest a block can be, in characters of words, to be a heading. */
export const longestHeading = 120;

/** A reference's character; one no character has reads as a space. */
const character = (codePoint: number | undefined): string =>
  codePoint !== undefined && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : " ";

/**
 * Text's words alone: without markup, every character reference read as
 * HTML reads it (a bio is stored raw, "S&#233;bastien", where the
 * sanitized description says "Sébastien"), lowercase, with every run of
 * other characters (punctuation, quotes of any kind, zero-width spaces)
 * one space.
 */
export function wordsOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);?/g, (_, digits: string) => character(Number(digits)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) =>
      character(Number.parseInt(hex, 16)),
    )
    .replace(/&([a-z][a-z0-9]*);/gi, (entity, name: string) => {
      // One HTML doesn't know stays as written, as HTML shows it.
      const codePoint = namedReferences.get(name);
      return codePoint === undefined ? entity : character(codePoint);
    })
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Sanitized HTML's top-level blocks, in order, each as written: an element
 * with all it holds, or the text between elements.
 */
export function blocksOf(html: string): ReadonlyArray<string> {
  const blocks: Array<string> = [];
  const tag = /<(\/?)([a-z][a-z0-9]*)\b[^>]*?(\/?)>/gi;
  const voids = new Set(["br", "hr", "img", "wbr"]);
  let depth = 0;
  let start = 0;
  for (const match of html.matchAll(tag)) {
    const [whole, closing, name = "", selfClosing] = match;
    const at = match.index;
    const isVoid = voids.has(name.toLowerCase()) || selfClosing === "/";
    if (depth === 0 && closing === "" && at > start) {
      blocks.push(html.slice(start, at));
      start = at;
    }
    if (isVoid) {
      if (depth === 0) {
        blocks.push(html.slice(start, at + whole.length));
        start = at + whole.length;
      }
      continue;
    }
    depth += closing === "/" ? -1 : 1;
    if (depth === 0) {
      blocks.push(html.slice(start, at + whole.length));
      start = at + whole.length;
    }
  }
  if (start < html.length) blocks.push(html.slice(start));
  return blocks.filter((block) => block.trim() !== "");
}

/** Whether `block`'s words are a repeat of one of `sources`. */
const isRepeat = (block: string, sources: ReadonlyArray<string>): boolean =>
  block.length >= minimumRepeat &&
  sources.some(
    (source) =>
      source.includes(block) ||
      (source.length >= minimumRepeat &&
        block.includes(source) &&
        source.length >= wholeShare * block.length),
  );

/**
 * A block that is only a heading: a heading element, or a paragraph whose
 * one child is bold, as Luma writes them ("**Speakers**").
 */
const isHeading = (block: string): boolean =>
  /^<(h[1-6])\b[^>]*>[\s\S]*<\/\1>$/i.test(block.trim()) ||
  /^<p\b[^>]*>\s*<(strong|b)\b[^>]*>[\s\S]*?<\/\1>\s*<\/p>$/i.test(
    block.trim(),
  );

/**
 * A block of a speaker's handles, one a line ("Twitter/X: @heff"), as the
 * stage shows their links.
 */
const isHandles = (block: string): boolean => {
  const lines = block
    .replace(/<br\s*\/?>|<\/(?:p|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return (
    lines.length > 0 &&
    lines.every((line) =>
      /^(?:twitter|x|twitter\/x|linkedin|bluesky|github|socials?|website)\s*:/i.test(
        line,
      ),
    )
  );
};

/** `about` without the blocks that repeat the stage (see the module's doc). */
export function withoutStageRepeats(about: SafeHtml, stage: Stage): SafeHtml {
  const sources = stage.talks
    .flatMap((talk) => [
      talk.description,
      ...talk.speakers.map((speaker) => speaker.bio),
    ])
    .flatMap((text) => (text === null ? [] : [wordsOf(text)]))
    .filter((words) => words !== "");
  if (sources.length === 0) return about;
  const speakers = stage.talks.flatMap((talk) =>
    talk.speakers.map((speaker) => wordsOf(speaker.name)),
  );
  const names = [
    ...stage.talks.map((talk) => wordsOf(talk.title)),
    ...speakers,
  ].filter((words) => words !== "");
  // "About Steve": a speaker's section, by their first name.
  const abouts = speakers.flatMap((name) => {
    const first = name.split(" ")[0] ?? "";
    return first === "" ? [] : [`about ${first}`, `about ${name}`];
  });

  const blocks = blocksOf(about);
  const words = blocks.map(wordsOf);
  const dropped = words.map((block) => isRepeat(block, sources));
  if (!dropped.includes(true)) return about;
  const names_ = (index: number) => {
    const block = words[index] ?? "";
    return (
      block !== "" &&
      block.length <= longestHeading &&
      (abouts.includes(block) ||
        names.some((name) => ` ${block} `.includes(` ${name} `)))
    );
  };
  // What goes with a repeat, until nothing more does: its speaker's
  // handles beside it, and the heading over it that names a speaker or a
  // talk ("About Steve", '"History of React" w/ Tom Occhino').
  for (let changed = true; changed; ) {
    changed = false;
    blocks.forEach((block, index) => {
      if (dropped[index]) return;
      const beside = dropped[index - 1] === true || dropped[index + 1] === true;
      if (
        (beside && isHandles(block)) ||
        (dropped[index + 1] === true && names_(index))
      ) {
        dropped[index] = true;
        changed = true;
      }
    });
  }
  // A heading whose whole section went with it ("Speakers") goes too: up
  // to the next heading kept, or the end, everything under it was dropped.
  blocks.forEach((block, index) => {
    if (dropped[index] || !isHeading(block) || words[index] === "") return;
    let next = index + 1;
    while (next < blocks.length && dropped[next] === true) next += 1;
    const under = next - index - 1;
    const ends = next === blocks.length || isHeading(blocks[next] ?? "");
    if (under > 0 && ends) dropped[index] = true;
  });
  // Kept blocks are the sanitized text as it was, so the rest stays safe.
  return blocks.filter((_, index) => !dropped[index]).join("") as SafeHtml;
}
