/**
 * Each event is all things/<topic>, and lists write it at/<topic>
 * (brand/foundations.md, "Name"). Events are named on Luma by people, not
 * by the brand, so the topic is derived from the name by one fixed rule:
 *
 * 1. Emoji and other pictographs go, then a trailing "!", "?" or ".".
 * 2. A leading "All Things " goes: "All Things Agent Setups" → "Agent Setups".
 * 3. A trailing venue goes, since the place is said beside the name:
 *    "React Bay Area at Mux" → "React Bay Area", "… @ Vercel HQ" likewise.
 * 4. A trailing city goes: "Effect San Francisco" → "Effect".
 * 5. What is left, lowercased, is the topic if it reads as one: at most
 *    24 characters of letters, digits, spaces and . & + # ' (a hyphen only
 *    inside a word), and not another "all things".
 *
 * A name that yields no topic, such as "Pre Next.js Conf / Ship AI Meetup"
 * (a slash of its own) or "TypeScript AI: The official conference
 * after-party" (a subtitle), is shown as written instead: the slash and
 * the lockup belong to topics only.
 */

/**
 * Emoji, flags, and what joins or modifies them: variation selectors, the
 * zero-width joiner and the keycap mark. Alternatives rather than one
 * character class, since the joiner and the keycap mark combine.
 */
const pictographs =
  /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{FE0E}|\u{FE0F}|\u{200D}|\u{20E3}/gu;

/** The longest topic the lockup sets; longer names read better as written. */
export const maxTopicLength = 24;

/** Starts with a letter or digit; a hyphen joins two of them. */
const topicShape =
  /^[\p{L}\p{N}](?:[\p{L}\p{N} .&+#']|(?<=[\p{L}\p{N}])-(?=[\p{L}\p{N}]))*$/u;

/** The event's name without emoji, its spacing tidied: how lists show it. */
export function displayName(name: string): string {
  return name
    .normalize("NFC")
    .replace(pictographs, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The event's topic, such as "effect" for "Effect San Francisco 🇺🇸", if it has one. */
export function topicOf(name: string): string | undefined {
  const topic = displayName(name)
    .replace(/[!?.]+$/, "")
    .replace(/^all things\s+/i, "")
    .replace(/\s+(?:at|@)\s+.+$/i, "")
    .replace(/\s+(?:in\s+)?(?:san francisco|sf)$/i, "")
    .trim()
    .toLowerCase();
  const reads =
    topic.length > 0 &&
    topic.length <= maxTopicLength &&
    topicShape.test(topic) &&
    !topic.includes("all things");
  return reads ? topic : undefined;
}
