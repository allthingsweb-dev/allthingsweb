import { roleColor, tokens } from "allthings-brand/src/tokens.ts";
import type { EventPage } from "allthings-core/src/event-page.ts";
import type { OgFontMetrics, OgFonts, OgMetrics } from "../../scripts/build.ts";
import { built } from "../assets.ts";
import { hostNames } from "../pages/home.tsx";
import type { OgImage } from "../pages/metadata.tsx";
import type { DateTime } from "effect";
import { clockTime, day, year } from "../pages/time.ts";

/**
 * An event's link-preview card, as the foundations want covers:
 * typographic, generated from the event's data (brand/foundations.md,
 * "Imagery"). Its ground is the brand's (brand/marks/og.py, in the event's
 * mode, signed with a/); its words are laid out here and drawn over the
 * ground by Cloudflare's Images binding (route.ts), in instances of the
 * site's fonts whose advances og.py measured:
 *
 *     THU OCT 16 · 6:00 PM                         (meta, Geist Mono)
 *
 *     allthings/                                   (the lockup, Archivo 800)
 *     effect_
 *
 *     EAST CUT · CODERABBIT                    a/  (label, Archivo 700 75%)
 *
 * The lockup is allthings/<topic>, or the name as written when it has no
 * topic, as large as fits; the cursor follows while the evening is ahead.
 * Its old covers carry the old name, so they are never used.
 */

export const cardWidth = 1200;
export const cardHeight = 630;
const margin = 72;
const measure = cardWidth - 2 * margin;

/** The word a topic's lockup starts with, before the slash. */
const lockupWord = "allthings";

/** What a card says, and nothing else: its version is a hash of this. */
export interface CardFacts {
  readonly slug: string;
  readonly mode: EventPage["mode"];
  /** allthings/<topic>, or `name` alone when there is none. */
  readonly topic: string | undefined;
  readonly name: string;
  /** Whether the cursor follows: the evening is ahead or on now. */
  readonly ahead: boolean;
  /** "THU OCT 16 · 6:00 PM", with the year when it isn't this one. */
  readonly when: string;
  /** "EAST CUT · CODERABBIT", or "" when neither is known. */
  readonly label: string;
}

/**
 * "Thu Oct 16 · 6:00 PM", or "Tue Mar 26, 2024 · 5:00 PM" for an evening
 * in another year than `now`'s (in San Francisco): a card shared on its
 * own says which year it means.
 */
export function cardWhen(
  startsAt: DateTime.DateTime,
  now: DateTime.DateTime,
): string {
  const date =
    year(startsAt) === year(now)
      ? day(startsAt)
      : `${day(startsAt)}, ${year(startsAt)}`;
  return `${date} · ${clockTime(startsAt)}`;
}

/** What `event`'s card says as of `now`. */
export function cardFacts(event: EventPage, now: DateTime.DateTime): CardFacts {
  return {
    slug: event.slug,
    mode: event.mode,
    topic: event.topic,
    name: event.name,
    ahead: event.status !== "past",
    when: cardWhen(event.startsAt, now).toUpperCase(),
    label: [
      ...(event.venue?.neighborhood === undefined ||
      event.venue.neighborhood === null
        ? []
        : [event.venue.neighborhood]),
      ...(event.hosts.length === 0 ? [] : [hostNames(event.hosts)]),
    ]
      .join(" · ")
      .toUpperCase(),
  };
}

/** One run of text the card draws: in one font, size and color, at a place. */
export interface CardText {
  readonly text: string;
  readonly font: keyof OgFonts;
  /** Pixels. */
  readonly size: number;
  readonly color: string;
  /** The top left of the text's box, whose top is an ascent above its baseline. */
  readonly left: number;
  readonly top: number;
}

/** `text`'s advance at `size`, by og.py's measure; unknown characters count wide. */
export function textWidth(
  metrics: OgFontMetrics,
  text: string,
  size: number,
): number {
  const widest = Math.max(...Object.values(metrics.advances));
  let width = 0;
  for (const char of text) width += metrics.advances[char] ?? widest;
  return (width * size) / 1000;
}

/** `text` cut to fit `width` with an ellipsis, if it doesn't. */
function fit(
  metrics: OgFontMetrics,
  text: string,
  size: number,
  width: number,
): string {
  if (textWidth(metrics, text, size) <= width) return text;
  let cut = Array.from(
    new Intl.Segmenter().segment(text),
    (part) => part.segment,
  );
  while (
    cut.length > 0 &&
    textWidth(metrics, `${cut.join("")}…`, size) > width
  ) {
    cut = cut.slice(0, -1);
  }
  return `${cut.join("").trimEnd()}…`;
}

/** Words set into lines no wider than `width`, a word too long cut to fit. */
function wrap(
  metrics: OgFontMetrics,
  text: string,
  size: number,
  width: number,
): Array<string> {
  const lines: Array<string> = [];
  for (const word of text.split(/\s+/).filter((part) => part !== "")) {
    const last = lines.at(-1);
    const joined = last === undefined ? word : `${last} ${word}`;
    if (last !== undefined && textWidth(metrics, joined, size) <= width) {
      lines[lines.length - 1] = joined;
    } else {
      lines.push(fit(metrics, word, size, width));
    }
  }
  return lines;
}

/** The lockup's sizes, largest first: the first its words fit at is used. */
const lockupSizes = [132, 112, 96, 80, 64] as const;
const metaSize = 26;
/** The least room between the meta line and the lockup's top. */
const lockupGap = 40;
const labelSizes = [40, 34, 28] as const;
const smallestLabel = 28;

/** The card's words, laid out: what route.ts draws, in order. */
export function layoutCard(
  facts: CardFacts,
  metrics: OgMetrics,
): ReadonlyArray<CardText> {
  const colors = {
    text: roleColor(tokens, facts.mode, "text").hex,
    meta: roleColor(tokens, facts.mode, "meta").hex,
    place: roleColor(tokens, facts.mode, "link").hex,
    slash: roleColor(tokens, facts.mode, "slash").hex,
  };
  const texts: Array<CardText> = [];
  const top = (font: keyof OgFonts, size: number, baseline: number) =>
    Math.round(baseline - (metrics[font].ascent * size) / 1000);

  texts.push({
    text: fit(metrics.meta, facts.when, metaSize, measure),
    font: "meta",
    size: metaSize,
    color: colors.meta,
    left: margin,
    top: top("meta", metaSize, margin + metaSize),
  });

  // The label along the foot, as large as fits, beside the a/ mark.
  const labelBaseline = cardHeight - margin;
  const labelMeasure = measure - 120;
  const labelSize =
    labelSizes.find(
      (size) => textWidth(metrics.label, facts.label, size) <= labelMeasure,
    ) ?? smallestLabel;
  if (facts.label !== "") {
    texts.push({
      text: fit(metrics.label, facts.label, labelSize, labelMeasure),
      font: "label",
      size: labelSize,
      color: colors.place,
      left: margin,
      top: top("label", labelSize, labelBaseline),
    });
  }

  // The lockup above it: "allthings/" over the topic, or the name.
  const words = facts.topic ?? facts.name;
  const maxLines = facts.topic === undefined ? 3 : 2;
  const cursorWidth = (size: number) => textWidth(metrics.lockup, "_", size);
  const lastBaseline = labelBaseline - labelSize - 56;
  // The lockup's top may come no nearer the meta line than this.
  const ceiling = margin + metaSize + lockupGap;
  const sized = lockupSizes.map((size) => {
    const lines = wrap(
      metrics.lockup,
      words,
      size,
      measure - cursorWidth(size),
    );
    const rows = facts.topic === undefined ? lines.length : lines.length + 1;
    const lineHeight = Math.round(size * 0.92);
    const firstBaseline = lastBaseline - (rows - 1) * lineHeight;
    return {
      size,
      lines,
      fits:
        lines.length <= maxLines &&
        top("lockup", size, firstBaseline) >= ceiling,
    };
  });
  const chosen = sized.find(({ fits }) => fits) ??
    sized[sized.length - 1] ?? { size: 64, lines: [] };
  const lines = chosen.lines.slice(0, maxLines);
  const { size } = chosen;
  const lineHeight = Math.round(size * 0.92);
  const rows = facts.topic === undefined ? lines.length : lines.length + 1;
  let baseline = lastBaseline - (rows - 1) * lineHeight;
  const lockupLeft = margin - Math.round(size * 0.04);

  if (facts.topic !== undefined) {
    texts.push({
      text: lockupWord,
      font: "lockup",
      size,
      color: colors.text,
      left: lockupLeft,
      top: top("lockup", size, baseline),
    });
    texts.push({
      text: "/",
      font: "lockup",
      size,
      color: colors.slash,
      left: Math.round(
        lockupLeft + textWidth(metrics.lockup, lockupWord, size),
      ),
      top: top("lockup", size, baseline),
    });
    baseline += lineHeight;
  }
  lines.forEach((line, index) => {
    texts.push({
      text: line,
      font: "lockup",
      size,
      color: colors.text,
      left: lockupLeft,
      top: top("lockup", size, baseline),
    });
    if (facts.ahead && index === lines.length - 1) {
      texts.push({
        text: "_",
        font: "lockup",
        size,
        color: colors.slash,
        left: Math.round(lockupLeft + textWidth(metrics.lockup, line, size)),
        top: top("lockup", size, baseline),
      });
    }
    baseline += lineHeight;
  });
  return texts;
}

/** FNV-1a, 32 bits, in base 36: short, stable, and enough to tell versions apart. */
function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * The card's version: a hash of what it says (its facts and the lockup's
 * word) and of the ground and fonts it is drawn with, so a link preview
 * fetches it again when any changes.
 */
export const cardVersion = (facts: CardFacts): string =>
  fnv(
    JSON.stringify([
      facts,
      lockupWord,
      built.og.cards.eventNight.src,
      built.og.cards.eventPaper.src,
      built.og.fonts,
    ]),
  );

/** Where an event's card is: its own URL, stable, and the one link previews ask. */
export const cardPath = (slug: string): `/${string}` =>
  `/og/${encodeURIComponent(slug)}.png`;

/**
 * The event's card as of `now`, as its page names it, and what it says in
 * words. A new year changes what an older evening's card says, and so its
 * version.
 */
export function eventCard(
  event: EventPage,
  title: string,
  now: DateTime.DateTime,
): OgImage {
  return {
    src: `${cardPath(event.slug)}?v=${cardVersion(cardFacts(event, now))}`,
    width: cardWidth,
    height: cardHeight,
    alt: [
      title,
      cardWhen(event.startsAt, now),
      ...(event.venue?.neighborhood === undefined ||
      event.venue.neighborhood === null
        ? []
        : [event.venue.neighborhood]),
      ...(event.hosts.length === 0 ? [] : [hostNames(event.hosts)]),
    ].join(" · "),
  };
}
