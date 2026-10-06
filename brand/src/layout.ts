import { belowWidth } from "./css.ts";
import { type DimensionGroup, dimension, tokens } from "./tokens.ts";

/**
 * The layout tokens as numbers, for what CSS can't say on its own: how wide
 * an image is shown (its `sizes`) and how large a portrait's box is (its
 * width and height). The stylesheet reads the same tokens, as custom
 * properties (css.ts), so the two can't drift apart.
 */

const px = (group: DimensionGroup, name: string): number =>
  dimension(tokens, group, name).px;

const extension = tokens.$extensions["dev.allthings"];

/** The grid's columns, and those a ledger's labels take. */
export const columns = extension.gridColumns;
export const ledgerColumns = extension.ledgerColumns;

/** The page at its widest, its margins included, and the grid's gutter. */
export const pageWidth = px("layout", "page");
export const gutter = px("layout", "gutter");

const margin = dimension(tokens, "layout", "margin");
const marginViewport =
  margin.fluid !== undefined && "viewport" in margin.fluid
    ? margin.fluid.viewport
    : 0;

/** The squares portraits are shown at, in CSS pixels. */
export const portrait = {
  xs: px("size", "portraitXs"),
  s: px("size", "portraitS"),
  m: px("size", "portraitM"),
  l: px("size", "portraitL"),
  xl: px("size", "portraitXl"),
} as const;

/** The widest a post's photo is shown. */
export const media = px("size", "media");

/** A step of the spacing scale, such as 3 for 12 px. */
export const space = (step: number): number => px("space", String(step));

export type Breakpoint = "s" | "m" | "l" | "xl";

/** The media condition that holds below `breakpoint`, as the stylesheet's `--at-below-*`. */
export const below = (breakpoint: Breakpoint): string =>
  belowWidth(px("breakpoint", breakpoint));

/** The share of the viewport the page's content spans between its margins. */
export const contentVw = 100 - 2 * marginViewport;

/** Boxes side by side: `parts` of them, `gap` px apart, across `span` of the grid's columns. */
export interface Share {
  readonly span: number;
  readonly parts: number;
  readonly gap: number;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** How wide one of a share's boxes is, as `a` vw less `b` px, while the margins narrow with the screen. */
function fluid({ span, parts, gap }: Share): string {
  const vw = (contentVw * span) / columns / parts;
  const less = (gutter * (1 - span / columns) + (parts - 1) * gap) / parts;
  return less === 0
    ? `${round(vw)}vw`
    : `calc(${round(vw)}vw - ${round(less)}px)`;
}

/** How wide one of a share's boxes is on the widest page. */
function widest({ span, parts, gap }: Share): number {
  const content = pageWidth - 2 * margin.px;
  const box = (content * span) / columns - gutter * (1 - span / columns);
  return Math.round((box - (parts - 1) * gap) / parts);
}

/**
 * An image's `sizes` for a box of `wide`, which below `narrow.below` is a
 * box of `narrow` instead: the browser picks a width from it before the
 * stylesheet has loaded.
 */
export function sizes(
  wide: Share,
  narrow?: Share & { readonly below: Breakpoint },
): string {
  return [
    ...(narrow === undefined
      ? []
      : [`${below(narrow.below)} ${fluid(narrow)}`]),
    `${belowWidth(pageWidth)} ${fluid(wide)}`,
    `${widest(wide)}px`,
  ].join(", ");
}
