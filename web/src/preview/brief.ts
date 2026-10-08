import { Marked } from "marked";

/**
 * A brief section's Markdown (planning.brief_sections, written by the
 * studio) as the collaborators' panel shows it. The brief needs more than
 * the site's rich text (core/src/rich-text.ts) allows: subheadings and
 * tables, for the run of show and the rounds. So it has its own small
 * renderer, which writes only the tags below and checks its own output:
 *
 * - Text is escaped by Marked, as always.
 * - Raw HTML, images and rules are dropped.
 * - Links keep only http, https and mailto, and open in a new tab without
 *   access to this page, as rich text's do.
 * - `###` is the section's subheading (h4), anything deeper an h5: the
 *   section's own heading is the panel's h3.
 *
 * If the output still holds any other tag or attribute, the section is
 * shown as escaped plain text instead. The page runs no script under its
 * Content-Security-Policy either way (web/src/pages/response.ts).
 */

/** The tags a brief may produce, and the attributes each may carry. */
const allowed: Readonly<Record<string, ReadonlySet<string>>> = {
  p: new Set(),
  br: new Set(),
  strong: new Set(),
  em: new Set(),
  s: new Set(),
  code: new Set(["class"]),
  pre: new Set(),
  blockquote: new Set(),
  ul: new Set(),
  ol: new Set(["start"]),
  li: new Set(),
  a: new Set(["href", "target", "rel"]),
  h4: new Set(),
  h5: new Set(),
  table: new Set(),
  thead: new Set(),
  tbody: new Set(),
  tr: new Set(),
  th: new Set(["align"]),
  td: new Set(["align"]),
};

const escape = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const safeHref = (href: string): string | null => {
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
};

const markdown = new Marked({
  gfm: true,
  renderer: {
    html() {
      return "";
    },
    image() {
      return "";
    },
    hr() {
      return "";
    },
    heading(token) {
      const tag = token.depth <= 3 ? "h4" : "h5";
      return `<${tag}>${this.parser.parseInline(token.tokens)}</${tag}>\n`;
    },
    link(token) {
      const text = this.parser.parseInline(token.tokens);
      const href = safeHref(token.href);
      return href === null
        ? text
        : `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

const tag = /<\/?([a-z0-9]+)((?:\s+[a-z]+="[^"<>]*")*)\s*\/?>/g;
const attribute = /\s+([a-z]+)="([^"<>]*)"/g;

/** Whether `html` holds only the tags and attributes a brief may have. */
export function onlyAllowed(html: string): boolean {
  // Anything that looks like a tag but isn't one of the forms below fails.
  const stripped = html.replace(tag, (_whole, name: string, attrs: string) => {
    const permitted = allowed[name];
    if (permitted === undefined) return "\u0000";
    for (const [, key = "", value = ""] of attrs.matchAll(attribute)) {
      if (!permitted.has(key)) return "\u0000";
      if (key === "align" && !["left", "center", "right"].includes(value)) {
        return "\u0000";
      }
      if (key === "class" && !/^language-[a-z0-9+#-]{1,32}$/.test(value)) {
        return "\u0000";
      }
    }
    return "";
  });
  return !stripped.includes("\u0000") && !stripped.includes("<");
}

/** A section's body as the panel shows it: allowed HTML, or its text escaped. */
export function briefHtml(body: string): string {
  const html = markdown.parse(body, { async: false });
  return onlyAllowed(html) ? html : `<pre>${escape(body)}</pre>`;
}
