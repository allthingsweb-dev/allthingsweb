import { resolveColor, roleColor, tokens } from "allthings-brand/src/tokens.ts";
import type { PersonPage } from "allthings-core/src/people-directory.ts";
import type { OgFonts, OgMetrics, PersonPart } from "../../scripts/build.ts";
import { built } from "../assets.ts";
import { type Source, sourceOf } from "../images/variants.ts";
import type { OgImage } from "../pages/metadata.tsx";
import {
  type CardText,
  cardHeight,
  cardWidth,
  fit,
  fnv,
  textWidth,
  wrap,
} from "./event-card.ts";

/**
 * A person's link-preview card: the people card (brand/marks/og.py), made
 * theirs. Its ground is the people card's, with its meta naming their part
 * at our evenings and the rule their photo is drawn in; its words are laid
 * out here and drawn over the ground by Cloudflare's Images binding
 * (route.ts), with their photo, or the blank avatar, in its box:
 *
 *     ORGANIZER                            ┌──────────────┐  (meta, ground)
 *                                          │              │
 *     allthings/_                          │    photo     │  (wordmark, ground)
 *                                          │              │
 *     Erik                                 │              │  (name, Archivo 800)
 *                                          │              │
 *     Head of Developer Experience, Code…  │              │  (title, Archivo 500)
 *     @erikthorelli                        └──────────────┘  (X handle, Geist Mono)
 *
 * The name is their first name when their name starts with one that reads
 * cleanly, else their name as written. What their profile leaves empty
 * (title, X handle) is left out, never filled in.
 */

const margin = 72;
/** The least room between the words and the photo: half the margin. */
const gutter = margin / 2;

/** What a person's card says, and nothing else: its version is a hash of this. */
export interface PersonCardFacts {
  readonly slug: string;
  /** Their part at our evenings, which the card's meta names. */
  readonly part: PersonPart;
  /** Their first name, or their name as written. */
  readonly name: string;
  readonly title: string | null;
  /** Their X handle, without the @, or null. */
  readonly handle: string | null;
  /** Their photo on the media origin, or null: the blank avatar stands in. */
  readonly photo: Source | null;
}

/**
 * Their part as the people page groups people: organizing first, then a
 * talk (in any capacity on stage), then co-hosting, then MCing; "people"
 * for someone with no part yet.
 */
export function personPart(person: PersonPage): PersonPart {
  if (person.organizes) return "organizer";
  const { parts } = person;
  if (parts.some((part) => part.kind === "talk")) return "speaker";
  const has = (role: string) =>
    parts.some((part) => part.kind === "role" && part.role === role);
  if (has("co-host")) return "co-host";
  if (has("mc")) return "mc";
  return "people";
}

/**
 * A first name that reads cleanly: a capital, then letters, with a hyphen
 * or apostrophe between parts ("Kit", "JJ", "Jean-Baptiste", "Sébastien"),
 * never an initial or a title ("J.", "Dr.").
 */
const cleanFirstName = /^\p{Lu}[\p{L}\p{M}]+(?:[-'’]\p{L}[\p{L}\p{M}]*)*$/u;

/** Their first name, when their name starts with one that reads cleanly; else their name. */
export function firstName(name: string): string {
  const words = name.trim().split(/\s+/);
  const [first] = words;
  return words.length > 1 && first !== undefined && cleanFirstName.test(first)
    ? first
    : words.join(" ");
}

/** What X allows in a handle. */
const handlePattern = /^[A-Za-z0-9_]{1,15}$/;

/** The handle an X link names, without the @, or null when it names none. */
export function xHandle(url: string | null): string | null {
  if (url === null) return null;
  const parsed = URL.parse(url);
  if (
    parsed === null ||
    !/^(?:www\.)?(?:twitter|x)\.com$/.test(parsed.hostname)
  ) {
    return null;
  }
  const handle = (parsed.pathname.split("/")[1] ?? "").replace(/^@/, "");
  return handlePattern.test(handle) ? handle : null;
}

/** What `person`'s card says. */
export function personCardFacts(person: PersonPage): PersonCardFacts {
  const title = person.title?.replace(/\s+/g, " ").trim() ?? "";
  return {
    slug: person.slug,
    part: personPart(person),
    name: firstName(person.name),
    title: title === "" ? null : title,
    handle: xHandle(person.links.x),
    photo: person.photo === null ? null : (sourceOf(person.photo) ?? null),
  };
}

/** The name's sizes, largest first: the people card's 112, then smaller. */
const nameSizes = [112, 96, 80, 64] as const;
/** The name's first baseline: the people card's "people". */
const nameBaseline = 330;
/** The title's sizes, largest first: the people card's sentences, then smaller. */
const titleSizes = [34, 30, 28, 26] as const;
const smallestTitle = 26;
const handleSize = 28;
/** The last line's baseline: the photo's foot, and the people card's last sentence. */
const footBaseline = cardHeight - margin;
/** The title's baseline above the handle's. */
const titleAboveHandle = 48;
/** The least room between the name's last line and the title. */
const nameGap = 32;

/** The card's words, laid out: what route.ts draws, in order, over the photo. */
export function layoutPersonCard(
  facts: PersonCardFacts,
  metrics: OgMetrics,
): ReadonlyArray<CardText> {
  const colors = {
    text: roleColor(tokens, "night", "text").hex,
    lead: resolveColor(tokens, "{color.mist}").hex,
    handle: roleColor(tokens, "night", "link").hex,
  };
  const measure = built.og.personPhoto.left - gutter - margin;
  const top = (font: keyof OgFonts, size: number, baseline: number) =>
    Math.round(baseline - (metrics[font].ascent * size) / 1000);
  const texts: Array<CardText> = [];

  // The handle along the foot, and the title over it: the people card's
  // two sentences, bottom-aligned with the photo.
  let titleTop = footBaseline;
  if (facts.handle !== null) {
    const handle = `@${facts.handle}`;
    texts.push({
      text: fit(metrics.meta, handle, handleSize, measure),
      font: "meta",
      size: handleSize,
      color: colors.handle,
      left: margin,
      top: top("meta", handleSize, footBaseline),
    });
    titleTop = top("meta", handleSize, footBaseline);
  }
  if (facts.title !== null) {
    const title = facts.title;
    const size =
      titleSizes.find(
        (candidate) => textWidth(metrics.lead, title, candidate) <= measure,
      ) ?? smallestTitle;
    const baseline =
      facts.handle === null ? footBaseline : footBaseline - titleAboveHandle;
    texts.push({
      text: fit(metrics.lead, title, size, measure),
      font: "lead",
      size,
      color: colors.lead,
      left: margin,
      top: top("lead", size, baseline),
    });
    titleTop = top("lead", size, baseline);
  }

  // The name, as large as fits: on one line if it can, else on two.
  const lineHeight = (size: number) => Math.round(size * 0.9);
  const words = facts.name.split(" ");
  const sized = nameSizes.map((size) => {
    const lines = wrap(metrics.lockup, facts.name, size, measure);
    const last = nameBaseline + (lines.length - 1) * lineHeight(size);
    // A size fits when no word is cut and the lines clear the title.
    const whole = words.every(
      (word) => textWidth(metrics.lockup, word, size) <= measure,
    );
    return { size, lines, fits: whole && last + nameGap <= titleTop };
  });
  const chosen =
    sized.find(({ lines, fits }) => lines.length === 1 && fits) ??
    sized.find(({ lines, fits }) => lines.length <= 2 && fits) ??
    sized[sized.length - 1];
  if (chosen !== undefined) {
    const { size } = chosen;
    // As og.py sets the people card's name: six pixels left of the margin at 112.
    const left = margin - Math.round((size * 6) / 112);
    // A name too long for two lines at the least size ends its second in an ellipsis.
    const [first = "", ...rest] = chosen.lines;
    const lines =
      rest.length === 0
        ? [first]
        : [first, fit(metrics.lockup, rest.join(" "), size, measure)];
    lines.forEach((line, index) => {
      texts.push({
        text: line,
        font: "lockup",
        size,
        color: colors.text,
        left,
        top: top("lockup", size, nameBaseline + index * lineHeight(size)),
      });
    });
  }
  return texts;
}

/** The card's ground: the people card's, its meta naming their part. */
export const personCardGround = (facts: PersonCardFacts) =>
  built.og.cards.person[facts.part];

/**
 * The card's version: a hash of what it says and shows (its facts, whose
 * photo carries its own version) and of the grounds, avatar, box and fonts
 * it is drawn with, so a link preview fetches it again when any changes.
 */
export const personCardVersion = (facts: PersonCardFacts): string =>
  fnv(
    JSON.stringify([
      facts,
      built.og.cards.person,
      built.marks.avatarPng.src,
      built.og.personPhoto,
      built.og.fonts,
    ]),
  );

/** Where a person's card is: its own URL, stable, and the one link previews ask. */
export const personCardPath = (slug: string): `/${string}` =>
  `/og/people/${encodeURIComponent(slug)}.png`;

/** The person's card as their page names it, and what it says in words. */
export function personCard(person: PersonPage): OgImage {
  const facts = personCardFacts(person);
  return {
    src: `${personCardPath(person.slug)}?v=${personCardVersion(facts)}`,
    width: cardWidth,
    height: cardHeight,
    alt: [
      person.name,
      ...(facts.title === null ? [] : [facts.title]),
      ...(facts.handle === null ? [] : [`@${facts.handle}`]),
      "allthings/_",
    ].join(" · "),
  };
}
