/**
 * Each event is allthings/<topic>, and lists write it at/<topic>
 * (brand/foundations.md, "Name"). An organizer may set the topic on the site
 * (`events.topic`); otherwise it is derived from the name, which people write
 * on Luma, not the brand, by one fixed rule:
 *
 * 1. Emoji and other pictographs go, then a trailing "!", "?" or ".".
 * 2. A leading name goes, the old way or the new: "All Things Agent Setups"
 *    → "Agent Setups", "allthings/effect" → "effect".
 * 3. A trailing venue goes, since the place is said beside the name:
 *    "React Bay Area at Mux" → "React Bay Area", "… @ Vercel HQ" likewise.
 * 4. A trailing city goes: "Effect San Francisco" → "Effect".
 * 5. What is left, lowercased, is the topic if it reads as one
 *    ({@link isTopic}).
 *
 * A name that yields no topic, such as "Pre Next.js Conf / Ship AI Meetup"
 * (a slash of its own) or "TypeScript AI: The official conference
 * after-party" (a subtitle), is shown as written unless the site sets one:
 * the slash and the lockup belong to topics only.
 */

/**
 * Emoji, flags, and what joins or modifies them: skin tones, variation
 * selectors, the zero-width joiner, the keycap mark and the tags of
 * subdivision flags. Alternatives rather than one character class, since
 * the joiner and the keycap mark combine.
 */
const pictographs =
  /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u{FE0E}|\u{FE0F}|\u{200D}|\u{20E3}|[\u{E0020}-\u{E007F}]/gu;

/** The longest topic the lockup sets, in characters; longer names read better as written. */
export const maxTopicLength = 24;

/**
 * Starts with a letter or digit; a space joins two words, a hyphen two
 * letters or digits. Letters are Unicode's Alphabetic characters and digits
 * are 0 to 9: what Postgres's builtin "pg_c_utf8" collation calls
 * [[:alpha:]] and [[:digit:]], so the CHECK on `events.topic` reads it the
 * same way in every database.
 */
const topicShape =
  /^[\p{Alphabetic}0-9](?:[\p{Alphabetic}0-9.&+#']|(?<=[^ ]) (?=[^ ])|(?<=[\p{Alphabetic}0-9])-(?=[\p{Alphabetic}0-9]))*$/u;

/**
 * Whether `topic` reads as one: at most {@link maxTopicLength} characters,
 * lowercase, in Unicode's composed form (NFC), of letters, digits, single
 * spaces and . & + # ' (a hyphen only inside a word), and not another "all
 * things". topicOf returns only topics, and the database holds
 * `events.topic` to the same rule with a CHECK constraint
 * (migrations/0002_event_topic.ts; tests/lockup.test.ts requires both to
 * agree).
 */
export function isTopic(topic: string): boolean {
  return (
    // Code points, as Postgres's char_length counts them: the shape admits
    // no emoji or other sequence that splitting by code point would break.
    Array.from(topic).length <= maxTopicLength &&
    topic === topic.normalize("NFC") &&
    topic === topic.toLowerCase() &&
    !topic.includes("all things") &&
    topicShape.test(topic)
  );
}

/** The event's name without emoji, its spacing tidied: how lists show it. */
export function displayName(name: string): string {
  return name
    .normalize("NFC")
    .replace(pictographs, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The topic the event's name yields, such as "effect" for "Effect San Francisco 🇺🇸", if any. */
export function topicOf(name: string): string | undefined {
  const topic = displayName(name)
    .replace(/[!?.]+$/, "")
    .replace(/^all\s*things(?:\s*\/\s*|\s+|$)/i, "")
    .replace(/\s+(?:at|@)\s+.+$/i, "")
    .replace(/\s+(?:in\s+)?(?:san francisco|sf)$/i, "")
    .trim()
    .toLowerCase();
  return isTopic(topic) ? topic : undefined;
}

/**
 * The event's topic: the one the site set (`events.topic`, which the Luma
 * sync never writes), else the one its name yields. A shared event has
 * none: it is someone else's evening, never allthings/anything, so it is
 * named as written.
 */
export function eventTopic(event: {
  readonly name: string;
  readonly topic: string | null;
  readonly curation: { readonly kind: "ours" | "shared" };
}): string | undefined {
  if (event.curation.kind === "shared") return undefined;
  return event.topic ?? topicOf(event.name);
}
