import sanitizeHtml from "sanitize-html";

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
