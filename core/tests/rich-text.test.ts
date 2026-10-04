import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  decodesWithoutSemicolon,
  namedReferences,
} from "../src/html-entities.ts";
import { htmlToPlainText, sanitizeRichText } from "../src/rich-text.ts";
import {
  appSanitize,
  corpus,
  divergences,
  expectedSanitized,
  markupProblems,
  unsafeParts,
} from "./support/rich-text.ts";

/**
 * Talk descriptions, sanitized in Bun as the Worker sanitizes them in workerd
 * (web/tests/rich-text.test.ts runs the same corpus there), against the app's
 * sanitize-html and against what makes HTML safe to render.
 */

const app = new URL("../../app/", import.meta.url);
const { htmlToPlainText: appPlainText } = (await import(
  new URL("src/lib/public-api/mappers.ts", app).href
)) as { htmlToPlainText: (html: string) => string };

const sanitize = async (html: string): Promise<string> =>
  Effect.runPromise(sanitizeRichText(html));

describe("sanitizeRichText", () => {
  test.each([...corpus])("%j", async (html) => {
    const sanitized = await sanitize(html);
    expect(sanitized).toBe(expectedSanitized(html));
    expect(unsafeParts(sanitized)).toEqual([]);
    expect(await markupProblems(sanitized)).toEqual([]);
    // Sanitized HTML reads back as itself, so a browser parses what we wrote.
    expect(await sanitize(sanitized)).toBe(sanitized);
  });

  test.each([...divergences])(
    "%j differs from the app's, harmlessly",
    (html, { html: expected }) => {
      expect(corpus).toContain(html);
      expect(appSanitize(html)).not.toBe(expected);
    },
  );
});

describe("htmlToPlainText", () => {
  test.each(corpus.filter((html) => !divergences.has(html)))(
    "%j reads as the app's",
    async (html) => {
      const sanitized = await Effect.runPromise(sanitizeRichText(html));
      expect(htmlToPlainText(sanitized)).toBe(appPlainText(appSanitize(html)));
    },
  );
});

describe("character references", () => {
  const names = [...namedReferences.keys()];

  test("the table is HTML 4.01's, apos and the uppercase legacy names", () => {
    expect(names.length).toBe(252 + 7);
  });

  // In text, before "=", before a letter, and in an attribute each way.
  test.each(names)(
    "&%s; and its legacy forms read as the app reads them",
    async (name) => {
      for (const html of [
        `&${name};`,
        `&${name} `,
        `&${name}x`,
        `<a title="&${name};|&${name}|&${name}=|&${name}x">t</a>`,
      ]) {
        expect(await sanitize(html)).toBe(appSanitize(html));
      }
      // The names the app decodes whole without ";" are the legacy ones.
      expect(appSanitize(`&${name} `) === appSanitize(`&${name}; `)).toBe(
        decodesWithoutSemicolon(name),
      );
    },
  );

  const codePoints = [
    ...Array.from({ length: 0x120 }, (_, index) => index),
    0x7ff,
    0x800,
    0xd7ff,
    0xd800,
    0xdbff,
    0xdc00,
    0xdfff,
    0xe000,
    0xfdd0,
    0xfffd,
    0xfffe,
    0xffff,
    0x10000,
    0x1f600,
    0x10fffe,
    0x10ffff,
    0x110000,
    0x7fffffff,
    0xffffffff,
  ];

  test.each(codePoints)(
    "&#%d; and &#x%x; read as the app reads them",
    async (code) => {
      for (const reference of [`&#${code}`, `&#x${code.toString(16)}`]) {
        for (const html of [
          `${reference};`,
          `${reference} `,
          `<a title="${reference};|${reference}">t</a>`,
        ]) {
          expect(await sanitize(html)).toBe(appSanitize(html));
        }
      }
    },
  );
});
