import { describe, expect, test } from "bun:test";
import { columns, gutter, pageWidth } from "allthings-brand/src/layout.ts";
import { dimension, tokens } from "allthings-brand/src/tokens.ts";
import type { OgMetrics } from "../scripts/build.ts";
import metrics from "../dist/og-metrics.json" with { type: "json" };
import { textWidth } from "../src/og/event-card.ts";
import { eventLockupSize } from "../src/pages/event.tsx";
import { lockupSize } from "../src/pages/home.tsx";

/**
 * A lockup never overflows its box, at any of the widths it is checked at.
 * It is laid out here as a browser lays it out, without one: the box's
 * width from the layout tokens, the size from the type tokens (the smaller
 * of a size and a share of the box), the tracking from site.css, and the
 * words measured in the lockup's own instance of Archivo (800, 112% wide),
 * whose advances brand/marks measured for the link-preview cards. Lines
 * break where a browser may: after the slash, at spaces and after hyphens.
 * A word wider than the box would overflow it, or be cut mid-word by
 * overflow-wrap, so every word must fit whole.
 *
 * The measure errs wide: it leaves out kerning and the inset that pulls the
 * first line back, and keeps the last letter's tracking, which its ink can
 * reach into. In Chrome, allthings/effect on one line at 112px is 870px
 * wide; this measures it 874.6, the 870 and that last letter's 4.5.
 */

const measured: OgMetrics = metrics;
const site = await Bun.file(
  new URL("../src/styles/site.css", import.meta.url),
).text();

/** The widths a lockup is checked at: desktop, small laptop, tablet, phone. */
const viewports = [1440, 1024, 768, 375] as const;

/** Every topic on allthings.dev today, and the longest name without one. */
const topics = [
  "effect",
  "agent setups",
  "sync",
  "typescript ai demo day",
  "dev setups",
  "devtool ax demos",
  "expo",
  "typescript ai afterparty",
  "react native after-party",
  "react native",
  "ship ai",
  "js trivia night",
  "agents for web dev",
  "lightning hackathon",
  "web show & tell",
  "nextdev.fm live",
  "web",
  "future of web hackathon",
  "ai",
  "web hack evening",
  "pre next.js conf meetup",
  "open source hackathon",
  "react bay area",
  "remix bay area",
] as const;
const untitled = "TypeScript AI: The official conference after-party";

/** A length token's px at `viewport`, as css.ts's clamp() and min() set it. */
const margin = (viewport: number): number => {
  const { px, fluid } = dimension(tokens, "layout", "margin");
  if (fluid === undefined || !("viewport" in fluid)) return px;
  const share = (fluid.viewport * viewport) / 100;
  return Math.min(px, Math.max(fluid.min?.value ?? 0, share));
};

/** The page's content: the viewport, at most the page, less its margins. */
const content = (viewport: number): number =>
  Math.min(viewport, pageWidth) - 2 * margin(viewport);

/** `span` of the grid's columns of `width`, with the gutters between them. */
const span = (width: number, count: number): number =>
  ((width - (columns - 1) * gutter) / columns) * count + (count - 1) * gutter;

/** A font-size token at a box `width` wide: min(its px, a share of the box). */
const fontSize = (name: string, width: number): number => {
  const { px, fluid } = dimension(tokens, "fontSize", name);
  return fluid !== undefined && "container" in fluid
    ? Math.min(px, (fluid.container * width) / 100)
    : px;
};

/** A rule's declaration in site.css, as written, if it makes one. */
const declared = (selector: string, property: string): string | undefined => {
  const block = new RegExp(
    `(?:^|\\n)${selector.replaceAll(".", "\\.")} \\{([^}]*)\\}`,
  ).exec(site)?.[1];
  return new RegExp(`${property}: ([^;]+);`).exec(block ?? "")?.[1];
};

/**
 * The tracking, in ems, of a lockup set by `base` and its size's rule
 * `sized`: the size's own, else the base's, as the cascade has it.
 */
const tracking = (base: string, sized: string): number => {
  const value =
    declared(sized, "letter-spacing") ?? declared(base, "letter-spacing");
  if (value?.endsWith("em") !== true) {
    throw new Error(`${sized} tracks in ${String(value)}, not em`);
  }
  return Number.parseFloat(value);
};

/** How wide `text` is set at `size` with `track` em between its letters. */
const width = (text: string, size: number, track: number): number =>
  textWidth(measured.lockup, text, size) +
  track * size * Math.max(0, Array.from(text).length - 1);

/** The pieces a line may break between: after a space or a hyphen. */
const pieces = (words: string): ReadonlyArray<string> =>
  words.split(/(?<=[ -])/);

interface Overflow {
  readonly line: string;
  readonly width: number;
  readonly box: number;
}

/**
 * `lines` set `size` px in a box `box` wide: each filled as a browser fills
 * it, and every piece that alone is wider than the box.
 */
function overflows(
  lines: ReadonlyArray<string>,
  size: number,
  track: number,
  box: number,
): ReadonlyArray<Overflow> {
  const set: Array<string> = [];
  for (const line of lines) {
    let current: string | undefined;
    for (const piece of pieces(line)) {
      const joined = `${current ?? ""}${piece}`;
      if (
        current === undefined ||
        width(joined.trimEnd(), size, track) <= box
      ) {
        current = joined;
      } else {
        set.push(current.trimEnd());
        current = piece;
      }
    }
    if (current !== undefined) set.push(current.trimEnd());
  }
  return set
    .map((line) => ({ line, width: width(line, size, track), box }))
    .filter((line) => line.width > box);
}

/** A lockup as a page sets it: allthings/ over the topic, with the cursor. */
const lockupLines = (topic: string | undefined): ReadonlyArray<string> =>
  topic === undefined ? [`${untitled}_`] : ["allthings/", `${topic}_`];

describe("the measure", () => {
  test("finds a lockup that can't fit: 112px on a phone", () => {
    expect(
      overflows(
        lockupLines("effect"),
        112,
        tracking(".event-name", ".event-name-l"),
        content(375),
      ),
    ).not.toEqual([]);
  });

  test("breaks where a browser may", () => {
    expect(pieces("react native after-party")).toEqual([
      "react ",
      "native ",
      "after-",
      "party",
    ]);
  });
});

/** The font-size tokens of each size a page sets a lockup at. */
const eventSizes = { l: "eventL", m: "eventM", s: "eventS" } as const;
const heroSizes = { l: "heroL", m: "heroM", s: "heroS" } as const;

describe("an evening's lockup", () => {
  for (const viewport of viewports) {
    test(`fits the page at ${viewport}px, for every topic`, () => {
      // The lockup spans the page's content (.event).
      const box = content(viewport);
      const found = [...topics, undefined].flatMap((topic) => {
        const size = eventLockupSize({ topic });
        return overflows(
          lockupLines(topic),
          fontSize(eventSizes[size], box),
          tracking(".event-name", `.event-name-${size}`),
          box,
        );
      });
      expect(found).toEqual([]);
    });
  }
});

describe("home's lockup", () => {
  /** The hero's text: 7 of the columns beside photos, the page below l. */
  const heroSpan = Number(
    /^span (\d+)$/.exec(
      declared(".with-photos .hero-text", "grid-column") ?? "",
    )?.[1],
  );
  const stacked = dimension(tokens, "breakpoint", "l").px;
  const boxes = (viewport: number) => ({
    alone: content(viewport),
    "beside photos":
      viewport < stacked
        ? content(viewport)
        : span(content(viewport), heroSpan),
  });

  for (const viewport of viewports) {
    test(`fits the hero at ${viewport}px, for every topic, with photos or without`, () => {
      expect(heroSpan).toBeGreaterThan(0);
      const found = Object.values(boxes(viewport)).flatMap((box) => [
        ...[...topics, undefined].flatMap((topic) => {
          const size = lockupSize({ topic });
          return overflows(
            lockupLines(topic),
            fontSize(heroSizes[size], box),
            tracking(".hero-name", `.lockup-${size}`),
            box,
          );
        }),
        // Nothing announced: the open slot, allthings/ over the cursor.
        ...overflows(
          ["allthings/", "_"],
          fontSize(heroSizes.l, box),
          tracking(".hero-name", ".lockup-l"),
          box,
        ),
      ]);
      expect(found).toEqual([]);
    });
  }
});
