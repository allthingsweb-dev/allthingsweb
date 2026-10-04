import sanitizeHtml from "sanitize-html";

/**
 * Talk descriptions are stored as editor HTML. These are the app's two views
 * of it, copied from app/src/lib/safe-html.ts and public-api/mappers.ts with
 * the same sanitize-html version, so that core says exactly what the app says.
 */

declare const safeHtmlBrand: unique symbol;

/** HTML that has passed through {@link sanitizeRichText} and may be rendered raw. */
export type SafeHtml = string & { readonly [safeHtmlBrand]: true };

const richTextOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "a",
  ],
  allowedAttributes: { a: ["href", "title", "target", "rel"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      target: "_blank",
      rel: "noopener noreferrer",
    }),
  },
};

/** Reduces editor-authored HTML to formatting and safe links. */
export function sanitizeRichText(html: string): SafeHtml {
  return sanitizeHtml(html, richTextOptions) as SafeHtml;
}

const entities: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Flattens sanitized HTML into readable plain text for agents. */
export function htmlToPlainText(html: SafeHtml): string {
  const withBreaks = html
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>|<\/(p|ul|ol|blockquote|pre|h[1-6])>/gi, "\n");
  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(
      /&(amp|lt|gt|quot|#39|nbsp);/g,
      (entity) => entities[entity] ?? entity,
    )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
