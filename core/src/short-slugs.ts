import { DateTime } from "effect";
import { displayName, eventTopic } from "./lockup.ts";
import type * as Rows from "./rows.ts";

/**
 * Each evening's short link: the lockup is the link (brand/foundations.md,
 * "Name"), so all things/effect lives at allthings.dev/effect.
 *
 * The rule, one evening at a time in the order they start:
 *
 * 1. Its base is its topic as a URL segment ("react native" → react-native),
 *    or, for a name that yields no topic, its name.
 * 2. It takes the first of these no other evening holds: the base, then the
 *    base and its month in San Francisco (web-2024-11), then the day
 *    (web-2024-11-12), then a count (web-2024-11-12-2).
 * 3. A shared evening is someone else's, never all things/anything, so its
 *    link is under shared/ (shared/typescript-ai-demo-day): the bare root
 *    stays the lockup's alone.
 *
 * A link, once given, is that evening's for good (`event_slugs`): the
 * first evening of a topic keeps the bare one, and a later evening of the
 * same topic is dated, so nothing printed, posted or put in a QR code ever
 * comes to mean another evening. An evening whose link changes keeps every
 * link it had, and they redirect to the new one.
 */

/** The prefix of a shared evening's link. */
export const sharedPrefix = "shared/";

/**
 * What no evening may be called: the site's own pages and files, and the
 * current site's, which still answer (web/tests/short-slugs.test.ts holds
 * this list to the Worker's routes and the legacy URLs).
 */
export const reservedSlugs: ReadonlySet<string> = new Set([
  "about",
  "admin",
  "api",
  "assets",
  "brand",
  "code-of-conduct",
  "events",
  "handler",
  "hero-image-404",
  "hero-image-goodbye",
  "hero-image-hackathon",
  "hero-image-meetup",
  "hero-image-rocket",
  "img",
  "logos",
  "mcp",
  "monitoring",
  "og",
  "people",
  "profile",
  "r",
  "rss",
  "sentry-example-page",
  "shared",
  "speakers",
]);

/**
 * A link's shape: lowercase letters and digits in words joined by single
 * hyphens, under shared/ for a shared evening. migrations' CHECK on
 * `events.short_slug` and `event_slugs.slug` is the same pattern.
 */
export const shortSlugPattern = "^(shared/)?[a-z0-9]+(-[a-z0-9]+)*$";
const shortSlugShape = new RegExp(shortSlugPattern);

/** Whether `slug` has a link's shape. */
export const isShortSlug = (slug: string): boolean => shortSlugShape.test(slug);

/** The longest base, in characters; a long name is cut at a word. */
export const maxBaseLength = 48;

/**
 * `text` as a URL segment: accents dropped, "&" and "+" spelled out, "#"
 * as "sharp", dots and apostrophes gone (next.js → nextjs), every other run
 * of characters a hyphen. Empty when nothing is left.
 */
export function slugify(text: string): string {
  const words = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/#/g, " sharp ")
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (words.length <= maxBaseLength) return words;
  const cut = words.slice(0, maxBaseLength + 1);
  const end = cut.lastIndexOf("-");
  return (end > 0 ? cut.slice(0, end) : cut.slice(0, maxBaseLength)).replace(
    /-+$/,
    "",
  );
}

/** An evening as the rule reads it. */
export interface SlugSource {
  readonly name: string;
  readonly topic: string | null;
  readonly curation: Pick<Rows.Curation, "kind">;
  readonly startDate: DateTime.Utc;
}

/** The link an evening asks for first: its topic, or its name, as a segment. */
export function baseSlug(event: SlugSource): string {
  const base =
    slugify(eventTopic(event) ?? displayName(event.name)) || "evening";
  return event.curation.kind === "shared" ? `${sharedPrefix}${base}` : base;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Where an evening's date is read: the calendar's zone, as its legacy slug was. */
const sanFrancisco = DateTime.zoneMakeNamedUnsafe("America/Los_Angeles");

/**
 * The links an evening may take, in the order it asks for them: the base,
 * then dated by month, then by day, then counted. Endless: the last kind
 * counts up.
 */
export function* slugCandidates(event: SlugSource): Generator<string> {
  const base = baseSlug(event);
  const day = DateTime.toParts(
    DateTime.makeZonedUnsafe(event.startDate, { timeZone: sanFrancisco }),
  );
  const month = `${base}-${day.year}-${pad(day.month)}`;
  const date = `${month}-${pad(day.day)}`;
  yield base;
  yield month;
  yield date;
  for (let count = 2; ; count++) yield `${date}-${count}`;
}

/**
 * Every slug held, with the evening that holds it: each link given
 * (`event_slugs`), and each long slug. A link wins over a long slug that
 * is the same, since the link is that evening's for good.
 */
export function heldSlugs(
  links: Iterable<{ readonly slug: string; readonly eventId: string }>,
  longSlugs: Iterable<{ readonly slug: string; readonly eventId: string }>,
): Map<string, string> {
  const held = new Map<string, string>();
  for (const { slug, eventId } of longSlugs) held.set(slug, eventId);
  for (const { slug, eventId } of links) held.set(slug, eventId);
  return held;
}

/**
 * The first link `event` may take: one no page is at and no other evening
 * holds. One the evening itself holds already (its own long slug, say,
 * when that is as short as its link would be) is its to take.
 */
export function shortSlugFor(
  event: SlugSource & { readonly eventId: string },
  held: ReadonlyMap<string, string>,
): string {
  for (const slug of slugCandidates(event)) {
    if (reservedSlugs.has(slug)) continue;
    const holder = held.get(slug);
    if (holder === undefined || holder === event.eventId) return slug;
  }
  // slugCandidates never ends; this is for the type checker.
  throw new Error("unreachable");
}

/** An evening that needs a link. */
export interface NeedsSlug extends SlugSource {
  readonly eventId: string;
}

/**
 * Links for `events`, given in the order they start (then by id), so the
 * first evening of a topic takes the bare link. `taken` is every slug
 * already held, with who holds it (`heldSlugs`); each link given here is
 * held for the next.
 */
export function planShortSlugs<E extends NeedsSlug>(
  events: ReadonlyArray<E>,
  taken: ReadonlyMap<string, string>,
): ReadonlyArray<{ readonly event: E; readonly slug: string }> {
  const held = new Map(taken);
  return events
    .toSorted(
      (a, b) =>
        DateTime.toEpochMillis(a.startDate) -
          DateTime.toEpochMillis(b.startDate) ||
        a.eventId.localeCompare(b.eventId),
    )
    .map((event) => {
      const slug = shortSlugFor(event, held);
      held.set(slug, event.eventId);
      return { event, slug };
    });
}
