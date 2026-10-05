import { HtmlValidate } from "html-validate";

/** What every page is held to, whichever route serves it. */

export const gzipped = (text: string) =>
  Bun.gzipSync(text, { level: 9 }).byteLength;

// The first round trip of a new connection carries about 14.6 KB (an
// initial congestion window of ten 1460-byte segments), so a page this
// size arrives whole in it.
export const htmlBudget = 14_000;
// One stylesheet serves every page and blocks rendering; with the HTML it
// stays under two initial windows.
export const cssBudget = 8_000;

/**
 * Links that only point somewhere, for search engines and feed readers:
 * a browser loads nothing for them.
 */
const pointers = /^<link rel="(?:canonical|alternate)"/;

/**
 * The page's subresources: what <link>, <script> and <img> load. Every
 * <link> counts but the pointers above, so a new kind of link is held to
 * the same rule as a stylesheet until it is known not to load.
 */
export function subresources(html: string): Array<string> {
  const tags = (
    html.match(/<(?:link|script|img|source|iframe)\b[^>]*>/g) ?? []
  ).filter((tag) => !pointers.test(tag));
  return tags.flatMap((tag) =>
    [...tag.matchAll(/\s(?:href|src|srcset)="([^"]*)"/g)].map(
      ([, value]) => value ?? "",
    ),
  );
}

/**
 * `html` without its JSON-LD: data blocks, which browsers never run and
 * whose "<" are all escaped (pages/structured-data.ts). What is left is
 * what a test of "runs no JavaScript" reads.
 */
export const withoutStructuredData = (html: string) =>
  html.replace(/<script type="application\/ld\+json">[^<]*<\/script>/g, "");

/** What the stylesheet loads with url(). */
export const stylesheetUrls = (css: string): Array<string> =>
  [...css.matchAll(/url\(([^)]*)\)/g)].map(([, value]) => value ?? "");

export const stylesheetOf = (html: string) => {
  const href = /<link rel="stylesheet" href="([^"]+)"/.exec(html)?.[1];
  if (href === undefined) throw new Error("The page links no stylesheet");
  return href;
};

const validator = new HtmlValidate({
  extends: ["html-validate:recommended"],
  rules: {
    // How @kitajs/html writes markup: a lowercase doctype, void elements
    // closed with "/>" and empty attributes as ="".
    "doctype-style": ["error", { style: "lowercase" }],
    "void-style": ["error", { style: "selfclose" }],
    "attribute-empty-style": ["error", { style: "empty" }],
  },
});

/** html-validate's findings, as "rule: message (selector)". */
export async function htmlProblems(html: string): Promise<Array<string>> {
  const report = await validator.validateString(html);
  return report.results.flatMap((result) =>
    result.messages.map((m) => `${m.ruleId}: ${m.message} (${m.selector})`),
  );
}

/** The heading levels in document order. */
export const headingLevels = (html: string): Array<number> =>
  [...html.matchAll(/<h([1-6])[ >]/g)].map(([, level]) => Number(level));
