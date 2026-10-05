import { Effect } from "effect";
import { Marked, type Token, type Tokens } from "marked";
import { displayName } from "../lockup.ts";
import { type SafeHtml, sanitizeRichText } from "../rich-text.ts";

/**
 * An event's description as Luma's API gives it (`description_md`: the
 * Markdown of Luma's editor), made into what the site stores and shows: rich
 * text the way talk descriptions are kept (src/rich-text.ts), and a one-line
 * summary for an event whose tagline is still a placeholder.
 *
 * Luma's editor writes a small Markdown: paragraphs, bold and italic, links,
 * lists, headings (often bold ones), images, rules and hard breaks, with
 * zero-width spaces scattered through it. What the site keeps:
 *
 * - Headings become bold paragraphs: the description sits under the page's
 *   own "About" label, and rich text has no headings.
 * - Images, rules and raw HTML are dropped. Pages show only photos from the
 *   media bucket, and rules split nothing in a ruled list.
 * - Everything else goes through `sanitizeRichText`, as talk descriptions
 *   do: formatting and http, https and mailto links only.
 */

/**
 * Characters Luma's editor leaves behind that show nothing: zero-width
 * spaces, word joiners and byte-order marks. The zero-width joiner stays,
 * since emoji sequences need it.
 */
const invisible = /[​⁠﻿]/gu;

/** `markdown` without the invisible characters Luma's editor leaves. */
const cleaned = (markdown: string): string =>
  markdown.replace(invisible, "").trim();

const markdown = new Marked({
  gfm: true,
  renderer: {
    heading(token) {
      // Luma's headings are often bold already: one <strong> is enough.
      const inline = this.parser
        .parseInline(token.tokens)
        .replace(/<\/?strong>/g, "");
      return `<p><strong>${inline}</strong></p>\n`;
    },
    paragraph(token) {
      // A paragraph of dashes or other marks alone ("--") is a divider.
      return /[\p{L}\p{N}]/u.test(plainText(token.tokens))
        ? `<p>${this.parser.parseInline(token.tokens).trim()}</p>\n`
        : "";
    },
    image() {
      return "";
    },
    hr() {
      return "";
    },
    html() {
      return "";
    },
    del(token) {
      return `<s>${this.parser.parseInline(token.tokens)}</s>`;
    },
  },
});

/** Text left once tags are dropped: whether sanitized HTML says anything. */
const saysSomething = (html: string): boolean =>
  html.replace(/<[^>]*>|&nbsp;|\s/g, "") !== "";

/**
 * `description_md` as the site stores it: sanitized rich text, or null when
 * it says nothing (Luma sends an empty string for none).
 */
export const descriptionHtml = (
  description: string | null,
): Effect.Effect<SafeHtml | null> => {
  const source = cleaned(description ?? "");
  if (source === "") return Effect.succeed(null);
  // A paragraph left empty by a dropped image says nothing either.
  const html = markdown
    .parse(source, { async: false })
    .replace(/<p>\s*<\/p>\n?/g, "");
  return Effect.map(sanitizeRichText(html), (safe) =>
    saysSomething(safe) ? safe : null,
  );
};

/** The most characters a summary has: it is a page's meta description. */
export const summaryLimit = 200;

/** The fewest words a summary's first sentence has. */
export const summaryMinWords = 5;

/** Plain text of inline tokens: what a reader sees, without markup. */
function plainText(tokens: ReadonlyArray<Token>): string {
  return tokens
    .map((token): string => {
      switch (token.type) {
        case "text":
        case "escape":
        case "codespan":
          return "tokens" in token && token.tokens !== undefined
            ? plainText(token.tokens)
            : token.text;
        case "strong":
        case "em":
        case "del":
        case "link":
          return plainText(token.tokens ?? []);
        case "br":
          return " ";
        default:
          return "";
      }
    })
    .join("");
}

/**
 * Whether a paragraph is all bold or italic: a heading written as one
 * ("**Talks & Speakers**", "**Location: Pier 70**"), not a sentence.
 */
function isEmphasisOnly(paragraph: Tokens.Paragraph): boolean {
  const visible = paragraph.tokens.filter(
    (token) =>
      token.type !== "br" &&
      !(token.type === "text" && token.text.trim() === ""),
  );
  return (
    visible.length > 0 &&
    visible.every((token) => token.type === "strong" || token.type === "em")
  );
}

/** What may close a sentence after its stop: quotes, brackets, a footnote's "*". */
const sentenceEnd = /[.!?]["'”’)\]*]*$/u;

/** A footnote's mark after a stop: it means nothing without the note. */
const footnoteMark = /(?<=[.!?])\*+(?=\s|$)/gu;

/**
 * The leading sentences of `text` that fit in {@link summaryLimit}, or null
 * when `text` doesn't end as a sentence or its first sentence is too short
 * or too long to stand alone.
 */
function leadingSentences(text: string): string | null {
  if (!sentenceEnd.test(text)) return null;
  const sentences = text.split(/(?<=[.!?]["'”’)\]*]*)\s+/u);
  const [first] = sentences;
  if (
    first === undefined ||
    first.length > summaryLimit ||
    first.split(/\s+/u).length < summaryMinWords
  ) {
    return null;
  }
  let summary = first;
  for (const sentence of sentences.slice(1)) {
    const longer = `${summary} ${sentence}`;
    if (longer.length > summaryLimit) break;
    summary = longer;
  }
  return summary.replace(footnoteMark, "");
}

/**
 * A one-line summary of `description_md`: the leading sentences, up to
 * {@link summaryLimit} characters, of its first paragraph that reads as
 * prose. Headings, lists and paragraphs that are all bold are skipped, and
 * so is a paragraph that doesn't end as a sentence ("Schedule:", a bare
 * link) or whose first sentence is under {@link summaryMinWords} words
 * ("Welcome to 2026 everyone!"). Emoji go, as they do from names. Null
 * when no paragraph qualifies.
 */
export function descriptionSummary(description: string | null): string | null {
  const source = cleaned(description ?? "");
  if (source === "") return null;
  for (const token of markdown.lexer(source)) {
    if (token.type !== "paragraph") continue;
    const paragraph = token as Tokens.Paragraph;
    if (isEmphasisOnly(paragraph)) continue;
    const summary = leadingSentences(displayName(plainText(paragraph.tokens)));
    if (summary !== null) return summary;
  }
  return null;
}
