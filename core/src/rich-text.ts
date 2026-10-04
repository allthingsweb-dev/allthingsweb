import { Effect } from "effect";
import { decodesWithoutSemicolon, namedReferences } from "./html-entities.ts";

/**
 * Talk descriptions are stored as editor HTML. These are the app's two views
 * of it (app/src/lib/safe-html.ts and public-api/mappers.ts), which use
 * sanitize-html. Core reads the HTML with the `HTMLRewriter` that workerd and
 * Bun build in, so the Worker ships no HTML parser, and decides what to keep
 * exactly as sanitize-html does with the app's options:
 *
 * - Tokens come from HTMLRewriter (lol-html), which tokenizes as browsers do.
 * - `Tree` builds elements from them as htmlparser2, sanitize-html's parser,
 *   does: the same implied end tags, void elements and foreign content.
 * - `Sanitizer` keeps what sanitize-html keeps: the allowed tags, links with
 *   http, https and mailto URLs only, and all text, escaped; the content of
 *   script, style, textarea, option and xmp is dropped.
 *
 * Where the two tokenizers disagree on malformed markup, the output is still
 * only what the allowlist permits; tests/support/rich-text.ts lists each case
 * that differs from the app and why.
 */

declare const safeHtmlBrand: unique symbol;

/** HTML that has passed through {@link sanitizeRichText} and may be rendered raw. */
export type SafeHtml = string & { readonly [safeHtmlBrand]: true };

/** Reduces editor-authored HTML to formatting and safe links. */
export const sanitizeRichText = (html: string): Effect.Effect<SafeHtml> =>
  Effect.promise(() => sanitize(html, 0));

const entities: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
};

/** Flattens sanitized HTML into readable plain text for agents. */
export function htmlToPlainText(html: SafeHtml): string {
  // Sanitized HTML escapes every "<" and ">" that isn't markup, so these
  // patterns see only tags, and its text has no other escapes.
  return html
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>|<\/(p|ul|ol|blockquote|pre|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt);/g, (entity) => entities[entity] ?? entity)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// What survives, as the app allows it.
const allowedTags = new Set([
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
]);
const linkAttributes = new Set(["href", "title", "target", "rel"]);
const allowedSchemes = new Set(["http", "https", "mailto"]);
/** Every link opens in a new tab, without access to this page. */
const linkTarget: ReadonlyArray<readonly [string, string]> = [
  ["target", "_blank"],
  ["rel", "noopener noreferrer"],
];
/** Disallowed elements whose text goes with them (sanitize-html's default). */
const nonTextTags = new Set(["script", "style", "textarea", "option", "xmp"]);

const xhtml = "http://www.w3.org/1999/xhtml";
/** Elements whose content HTML reads as raw text, entities and all. */
const rawTextElements = new Set([
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
  "script",
  "style",
  "xmp",
]);
/**
 * Raw text the app reads as markup after all: sanitize-html sanitizes an
 * iframe's fallback content again, and htmlparser2 parses noscript's.
 */
const markupInRawText = new Set(["iframe", "noscript"]);
/** How deep raw text is sanitized again before it is kept as plain text. */
const maxNesting = 8;

/** Sanitizes `html`, read as markup `nesting` levels inside raw text. */
async function sanitize(html: string, nesting: number): Promise<SafeHtml> {
  const sanitizer = new Sanitizer(nesting);
  const tree = new Tree(sanitizer);
  let text = "";
  let rawText: string | undefined;
  const flush = () => {
    if (text === "") return;
    tree.text(
      text,
      rawText === undefined
        ? "data"
        : markupInRawText.has(rawText)
          ? "markup"
          : "raw",
    );
    text = "";
  };
  await new HTMLRewriter()
    .on("*", {
      element(element) {
        flush();
        const name = element.tagName;
        let hasContent = true;
        try {
          // lol-html calls this for every element an end tag closes, with
          // that tag; act once, for the element the tag names.
          element.onEndTag((end) => {
            if (end.name !== name) return;
            flush();
            rawText = undefined;
            tree.close(name);
          });
        } catch {
          // Void elements, and "/>" in SVG and MathML, have no end tag.
          // (workerd has no `canHaveContent` or `selfClosing` to ask.)
          hasContent = false;
        }
        tree.open(name, [...element.attributes], !hasContent);
        rawText =
          element.namespaceURI === xhtml && rawTextElements.has(name)
            ? name
            : undefined;
      },
    })
    .onDocument({
      text(chunk) {
        text += chunk.text;
      },
      comments: flush,
      doctype: flush,
    })
    .transform(new Response(html))
    .arrayBuffer();
  flush();
  tree.end();
  const parts = await Promise.all(sanitizer.output.map(async (part) => part));
  return parts.join("") as SafeHtml;
}

/** Text to decode, raw text to keep as written, or raw text to sanitize. */
type TextKind = "data" | "raw" | "markup";

/** htmlparser2's elements that end those open at the top of the stack. */
const pTag = new Set(["p"]);
const headingTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p"]);
const formTags = new Set([
  "input",
  "option",
  "optgroup",
  "select",
  "button",
  "datalist",
  "textarea",
]);
const openImpliesClose: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["tr", new Set(["tr", "th", "td"])],
  ["th", new Set(["th"])],
  ["td", new Set(["thead", "th", "td"])],
  ["body", new Set(["head", "link", "script"])],
  ["a", new Set(["a"])],
  ["li", new Set(["li"])],
  ["p", pTag],
  ["h1", headingTags],
  ["h2", headingTags],
  ["h3", headingTags],
  ["h4", headingTags],
  ["h5", headingTags],
  ["h6", headingTags],
  ["select", formTags],
  ["input", formTags],
  ["output", formTags],
  ["button", formTags],
  ["datalist", formTags],
  ["textarea", formTags],
  ["option", new Set(["option"])],
  ["optgroup", new Set(["optgroup", "option"])],
  ["dd", new Set(["dd", "dt"])],
  ["dt", new Set(["dd", "dt"])],
  ...[
    "address",
    "article",
    "aside",
    "blockquote",
    "details",
    "div",
    "dl",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "header",
    "hr",
    "main",
    "nav",
    "ol",
    "pre",
    "section",
    "table",
    "ul",
  ].map((tag) => [tag, pTag] as const),
  ["rt", new Set(["rt", "rp"])],
  ["rp", new Set(["rt", "rp"])],
  ["tbody", new Set(["thead", "tbody"])],
  ["tfoot", new Set(["thead", "tbody"])],
]);
const voidElements = new Set([
  "area",
  "base",
  "basefont",
  "br",
  "col",
  "command",
  "embed",
  "frame",
  "hr",
  "img",
  "input",
  "isindex",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
/** Elements whose content is HTML again inside SVG or MathML. */
const htmlIntegrationElements = new Set([
  "mi",
  "mo",
  "mn",
  "ms",
  "mtext",
  "annotation-xml",
  "desc",
  "title",
]);

type Namespace = "html" | "svg" | "math";

interface OpenElement {
  readonly name: string;
  /** Whether opening it changed the namespace its content is read in. */
  readonly scopesNamespace: boolean;
}

/** htmlparser2's element building, fed lol-html's tokens. */
class Tree {
  private readonly stack: Array<OpenElement> = [];
  private readonly namespaces: Array<Namespace> = ["html"];
  private readonly sanitizer: Sanitizer;

  constructor(sanitizer: Sanitizer) {
    this.sanitizer = sanitizer;
  }

  private get namespace(): Namespace {
    return this.namespaces.at(-1) ?? "html";
  }

  private name(tagName: string): string {
    return tagName === "image" && this.namespace === "html" ? "img" : tagName;
  }

  open(
    tagName: string,
    attributes: ReadonlyArray<readonly [string, string]>,
    selfClosing: boolean,
  ): void {
    const name = this.name(tagName);
    // A form inside a form is ignored altogether.
    if (name === "form" && this.stack.some((open) => open.name === "form")) {
      return;
    }
    const implied = openImpliesClose.get(name);
    if (implied !== undefined) {
      while (implied.has(this.stack.at(-1)?.name ?? "")) this.pop();
    }
    if (voidElements.has(name)) {
      this.sanitizer.open(name, attributes);
      this.sanitizer.close(name);
      return;
    }
    const namespace: Namespace | undefined =
      name === "svg"
        ? "svg"
        : name === "math"
          ? "math"
          : htmlIntegrationElements.has(name) ||
              (name === "foreignobject" && this.namespace === "svg")
            ? "html"
            : undefined;
    this.stack.push({ name, scopesNamespace: namespace !== undefined });
    if (namespace !== undefined) this.namespaces.push(namespace);
    this.sanitizer.open(name, attributes);
    // htmlparser2 honors "/>" in SVG and MathML only.
    if (selfClosing && this.namespace !== "html") this.pop();
  }

  close(tagName: string): void {
    const name = this.name(tagName);
    if (voidElements.has(name)) return;
    const index = this.stack.findLastIndex((open) => open.name === name);
    if (index !== -1) {
      while (this.stack.length > index) this.pop();
    } else if (name === "p") {
      // "</p>" without a "<p>" is an empty paragraph.
      this.open("p", [], false);
      this.pop();
    }
  }

  text(source: string, kind: TextKind): void {
    this.sanitizer.text(source, kind);
  }

  /** Ends the elements still open, as the input ending does. */
  end(): void {
    for (const open of this.stack.toReversed()) this.sanitizer.close(open.name);
  }

  private pop(): void {
    const open = this.stack.pop();
    if (open === undefined) return;
    if (open.scopesNamespace) this.namespaces.pop();
    this.sanitizer.close(open.name);
  }
}

/** sanitize-html's decisions, with the app's options, as output. */
class Sanitizer {
  readonly output: Array<string | Promise<string>> = [];
  private readonly frames: Array<string> = [];
  private readonly skipped = new Set<number>();
  private depth = 0;
  /** Inside a dropped element whose text goes too: how many levels deep. */
  private skipTextDepth = 0;
  /** How many levels of raw text this is inside. */
  private readonly nesting: number;

  constructor(nesting: number) {
    this.nesting = nesting;
  }

  open(name: string, attributes: ReadonlyArray<readonly [string, string]>) {
    if (this.skipTextDepth > 0) {
      this.skipTextDepth++;
      return;
    }
    this.frames.push(name);
    if (!allowedTags.has(name)) {
      this.skipped.add(this.depth);
      if (nonTextTags.has(name)) this.skipTextDepth = 1;
      this.depth++;
      return;
    }
    this.depth++;
    this.output.push(
      name === "a"
        ? openLink(attributes)
        : name === "br"
          ? "<br />"
          : `<${name}>`,
    );
  }

  text(source: string, kind: TextKind) {
    if (this.skipTextDepth > 0) return;
    if (kind === "markup" && this.nesting < maxNesting) {
      this.output.push(sanitize(source, this.nesting + 1));
    } else if (kind === "data") {
      this.output.push(render(decode(source, false), escapeText));
    } else {
      this.output.push(escapeText(source));
    }
  }

  close(name: string) {
    if (this.skipTextDepth > 0) {
      this.skipTextDepth--;
      if (this.skipTextDepth > 0) return;
    }
    const frame = this.frames.pop();
    if (frame === undefined) return;
    if (frame !== name) {
      // Bad markup: leave the frame for a later end tag.
      this.frames.push(frame);
      return;
    }
    this.depth--;
    if (this.skipped.delete(this.depth) || name === "br") return;
    this.output.push(`</${name}>`);
  }
}

/** A link's start tag: its allowed attributes, then where it opens. */
function openLink(attributes: ReadonlyArray<readonly [string, string]>) {
  const values = new Map<string, ReadonlyArray<Piece>>();
  // The first of repeated attributes counts, as in HTML.
  for (const [name, value] of attributes) {
    if (!values.has(name)) values.set(name, decode(value, true));
  }
  for (const [name, value] of linkTarget) values.set(name, [value]);
  let tag = "<a";
  for (const [name, value] of values) {
    if (!linkAttributes.has(name) || value.length === 0) continue;
    if (name === "href" && !isSafeUrl(value)) continue;
    tag += ` ${name}="${render(value, escapeAttribute)}"`;
  }
  return `${tag}>`;
}

/**
 * Whether a link may point at `url`: an http, https or mailto URL, or a
 * relative one that isn't protocol-relative. Characters browsers ignore in
 * URLs (controls, whitespace, comments) don't hide a scheme. A named
 * reference this module can't decode might hide one, so it's refused.
 */
function isSafeUrl(url: ReadonlyArray<Piece>): boolean {
  if (!url.every((piece) => typeof piece === "string")) return false;
  // C0 controls and spaces, which browsers skip in a scheme.
  let href = Array.from(url.join(""))
    .filter((character) => character > " ")
    .join("");
  for (;;) {
    const start = href.indexOf("<!--");
    const end = start === -1 ? -1 : href.indexOf("-->", start + 4);
    if (end === -1) break;
    href = href.slice(0, start) + href.slice(end + 3);
  }
  const scheme = /^([a-zA-Z][a-zA-Z0-9.\-+]*):/.exec(href)?.[1];
  if (scheme === undefined) return !/^[/\\]{2}/.test(href);
  return allowedSchemes.has(scheme.toLowerCase());
}

/** Decoded text, or a named reference passed through as written. */
type Piece = string | { readonly name: string };

const escapeText = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (text: string) =>
  escapeText(text).replace(/"/g, "&quot;");

/** Escaped text; a reference passed through is still the browser's to decode. */
const render = (
  pieces: ReadonlyArray<Piece>,
  escape: (text: string) => string,
): string =>
  pieces
    .map((piece) =>
      typeof piece === "string" ? escape(piece) : `&${piece.name};`,
    )
    .join("");

/** What HTML reads 0x80–0x9F as in a numeric reference (Windows-1252). */
const windows1252: ReadonlyMap<number, number> = new Map([
  [0x80, 0x20ac],
  [0x82, 0x201a],
  [0x83, 0x0192],
  [0x84, 0x201e],
  [0x85, 0x2026],
  [0x86, 0x2020],
  [0x87, 0x2021],
  [0x88, 0x02c6],
  [0x89, 0x2030],
  [0x8a, 0x0160],
  [0x8b, 0x2039],
  [0x8c, 0x0152],
  [0x8e, 0x017d],
  [0x91, 0x2018],
  [0x92, 0x2019],
  [0x93, 0x201c],
  [0x94, 0x201d],
  [0x95, 0x2022],
  [0x96, 0x2013],
  [0x97, 0x2014],
  [0x98, 0x02dc],
  [0x99, 0x2122],
  [0x9a, 0x0161],
  [0x9b, 0x203a],
  [0x9c, 0x0153],
  [0x9e, 0x017e],
  [0x9f, 0x0178],
]);

function numericReference(digits: string): string {
  const codePoint =
    digits[0] === "x" || digits[0] === "X"
      ? Number.parseInt(digits.slice(1), 16)
      : Number.parseInt(digits, 10);
  if (
    codePoint === 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return "�";
  }
  return String.fromCodePoint(windows1252.get(codePoint) ?? codePoint);
}

/** The longest name `run` starts with that HTML decodes without ";". */
function legacyPrefix(run: string): string | undefined {
  for (let length = Math.min(run.length, 6); length >= 2; length--) {
    const name = run.slice(0, length);
    if (decodesWithoutSemicolon(name)) return name;
  }
  return undefined;
}

/**
 * Decodes character references as HTML does in text or, with `inAttribute`,
 * in an attribute value. A named reference with its semicolon that isn't in
 * the table is kept as written: HTML may know it, or may decode only a
 * prefix of it, and the browser will decide the same way either way.
 */
function decode(source: string, inAttribute: boolean): Array<Piece> {
  const pieces: Array<Piece> = [];
  let decoded = "";
  let last = 0;
  for (const match of source.matchAll(
    /&(?:#([xX][0-9a-fA-F]+|[0-9]+);?|([A-Za-z0-9]+)(;?))/g,
  )) {
    const [reference, digits, run, semicolon] = match;
    decoded += source.slice(last, match.index);
    last = match.index + reference.length;
    if (digits !== undefined) {
      decoded += numericReference(digits);
    } else if (run === undefined) {
      decoded += reference;
    } else if (semicolon === ";" && namedReferences.has(run)) {
      decoded += String.fromCodePoint(namedReferences.get(run) ?? 0xfffd);
    } else if (semicolon === ";" && /^[A-Za-z]/.test(run)) {
      pieces.push(decoded, { name: run });
      decoded = "";
    } else {
      const name = legacyPrefix(run);
      const next = run[name?.length ?? 0] ?? source[last] ?? "";
      if (name === undefined || (inAttribute && /[=A-Za-z0-9]/.test(next))) {
        decoded += reference;
      } else {
        decoded +=
          String.fromCodePoint(namedReferences.get(name) ?? 0xfffd) +
          reference.slice(name.length + 1);
      }
    }
  }
  pieces.push(decoded + source.slice(last));
  return pieces.filter((piece) => piece !== "");
}
