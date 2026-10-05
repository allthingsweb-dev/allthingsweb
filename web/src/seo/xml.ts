/**
 * Text for XML 1.0 documents, as the sitemap and the RSS feed write it.
 * Ported from app/src/lib/event-feeds.ts, which tests/seo.test.ts holds
 * these to.
 */

/**
 * Everything XML 1.0 forbids in a document (its `Char` production): the C0
 * controls but tab, newline and carriage return, lone surrogates, and
 * U+FFFE and U+FFFF. No escape can carry them, so they are dropped.
 */
const forbidden =
  // oxlint-disable-next-line no-control-regex -- exactly the characters XML 1.0 forbids
  /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

const entities: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/**
 * `value` as XML character data or an attribute value: the five markup
 * characters escaped and forbidden characters dropped, so no value can end
 * an element or add one.
 */
export function escapeXml(value: string): string {
  return value
    .replace(forbidden, "")
    .replace(/[&<>"']/g, (character) => entities[character] ?? "");
}
