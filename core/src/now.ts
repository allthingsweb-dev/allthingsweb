import { Schema } from "effect";
import { HttpUrl } from "./contract.ts";

/**
 * What someone who spoke at allthings does now (docs/now.md): a line in
 * the site's voice whose every fact links to where it was read, up to four
 * pieces of their own recent work, and the day it was all checked. It is
 * one of the people pipeline's sourced facts (core/backfill/people.json,
 * src/people-enrichment.ts), stored whole in `profiles.now_record`, so
 * taking it down is clearing one column.
 */

/** An https URL with a domain-name host, as the public contract accepts, and no whitespace. */
const Url = HttpUrl.check(Schema.isPattern(/^https:\/\/\S+$/));

/** A day on the calendar, YYYY-MM-DD: never a February 30th. */
const isDay = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value
  );
};

const Day = Schema.String.check(
  Schema.makeFilter((value: string) =>
    isDay(value)
      ? undefined
      : `${value} is not a YYYY-MM-DD day on the calendar`,
  ),
);

/** A day, or only a month (YYYY-MM) where the page gives no day. */
const DayOrMonth = Schema.String.check(
  Schema.makeFilter((value: string) =>
    isDay(value) || isDay(`${value}-01`)
      ? undefined
      : `${value} is not a YYYY-MM-DD day or a YYYY-MM month`,
  ),
);

const Text = (max: number) =>
  Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(max),
    Schema.makeFilter((value: string) =>
      value.trim() === value && !/[\n\r\t]/.test(value)
        ? undefined
        : "expected one line with no surrounding space",
    ),
  );

/** One run of a line: plain text, or a fact linked to its source. */
export interface NowPart {
  readonly text: string;
  /** Where this fact was read; absent for the words around the facts. */
  readonly source?: string;
}

const linked = /\[([^[\]]+)\]\((https:\/\/[^\s()]+)\)/g;

/**
 * A line's runs, in order: `[a fact](https://its-source)` is a linked run,
 * everything else plain. A stray bracket is left in a plain run, which
 * {@link Line} refuses.
 */
export function lineParts(line: string): ReadonlyArray<NowPart> {
  const parts: Array<NowPart> = [];
  let at = 0;
  for (const match of line.matchAll(linked)) {
    if (match.index > at) parts.push({ text: line.slice(at, match.index) });
    parts.push({ text: match[1]!, source: match[2]! });
    at = match.index + match[0].length;
  }
  if (at < line.length) parts.push({ text: line.slice(at) });
  return parts;
}

/** The line as it reads, without its sources. */
export const lineText = (line: string): string =>
  lineParts(line)
    .map((part) => part.text)
    .join("");

/** The longest a line may read, in characters. */
export const maxLineLength = 280;

const isUrl = Schema.is(Url);

/**
 * One or two sentences, at most {@link maxLineLength} characters as they
 * read, ending in a full stop, with at least one fact linked to its source
 * and no bracket outside a link.
 */
const Line = Text(2000).check(
  Schema.makeFilter((line: string) => {
    const parts = lineParts(line);
    const sources = parts.flatMap((part) =>
      part.source === undefined ? [] : [part.source],
    );
    const plain = parts.filter((part) => part.source === undefined);
    const text = lineText(line);
    if (sources.length === 0) {
      return "expected at least one fact linked to its source: [a fact](https://…)";
    }
    if (plain.some((part) => /[[\]]/.test(part.text))) {
      return "expected every bracket to belong to a [fact](https://source) link";
    }
    const bad = sources.filter((source) => !isUrl(source));
    if (bad.length > 0) return `${bad.join(", ")} is not an https URL`;
    if (text.length > maxLineLength) {
      return `expected at most ${maxLineLength} characters as it reads, got ${text.length}`;
    }
    if (!text.endsWith(".")) return "expected it to end with a full stop";
    const sentences = text.match(/[.?!](?=\s|$)/g)?.length ?? 0;
    return sentences <= 2
      ? undefined
      : `expected one or two sentences, got ${sentences}`;
  }),
);

export const nowLinkKinds = [
  "post",
  "article",
  "video",
  "talk",
  "podcast",
] as const;
export type NowLinkKind = (typeof nowLinkKinds)[number];

/** A piece of their own recent work, which is its own source. */
export const NowLink = Schema.Struct({
  title: Text(160),
  /** As the page gives it: a day, or only a month. */
  date: DayOrMonth,
  url: Url,
  kind: Schema.Literals(nowLinkKinds),
});
export type NowLink = typeof NowLink.Type;

/** The month of a day or a month, YYYY-MM. */
const monthOf = (date: string): string => date.slice(0, 7);

/**
 * Whether `a` may come before `b` in a list that is latest first: a later
 * day, or, where either has only a month, a month no earlier.
 */
const notBefore = (a: string, b: string): boolean =>
  a.length === 10 && b.length === 10 ? a >= b : monthOf(a) >= monthOf(b);

/** The most links a record shows. */
export const maxLinks = 4;

export const Now = Schema.Struct({
  line: Line,
  /** Latest first, none dated after `checkedOn`. */
  links: Schema.Array(NowLink).check(
    Schema.isMaxLength(maxLinks),
    Schema.makeFilter((links: ReadonlyArray<NowLink>) =>
      links.every(
        (link, index) =>
          index === 0 || notBefore(links[index - 1]!.date, link.date),
      )
        ? undefined
        : "expected the links latest first",
    ),
  ),
  /** The day the line and the links were all read. */
  checkedOn: Day,
}).check(
  Schema.makeFilter(
    (now: { links: ReadonlyArray<NowLink>; checkedOn: string }) => {
      const late = now.links.find(
        (link) => !notBefore(now.checkedOn, link.date),
      );
      return late === undefined
        ? undefined
        : `"${late.title}" is dated ${late.date}, after the record was checked on ${now.checkedOn}`;
    },
  ),
);
export type Now = typeof Now.Type;

/**
 * The record as stored and compared: its keys in one order, so two
 * records that say the same thing are the same JSON.
 */
export const canonicalNow = (now: Now): string =>
  JSON.stringify({
    line: now.line,
    links: now.links.map((link) => ({
      title: link.title,
      date: link.date,
      url: link.url,
      kind: link.kind,
    })),
    checkedOn: now.checkedOn,
  });

/** A stored record, as `profiles.now_record` holds it, or null where it holds none. */
export const decodeStoredNow = Schema.decodeUnknownEffect(Schema.NullOr(Now), {
  onExcessProperty: "error",
});

/**
 * Whether a record checked on `checkedOn` is due again on `today` (both
 * YYYY-MM-DD): checked `days` or more days before.
 */
export const isStale = (checkedOn: string, today: string, days: number) =>
  (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${checkedOn}T00:00:00Z`)) /
    86_400_000 >=
  days;
