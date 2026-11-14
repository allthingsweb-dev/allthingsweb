import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as fontkit from "fontkit";
import tokenFile from "../../../brand/all-things.tokens.json" with { type: "json" };
import { explainChangeFile, faceFile, type Face, type Tone } from "./faces.ts";

/**
 * Draws the header's shields as SVG, in the allthings system: a label in
 * Geist Mono caps, the brand's slash, and the status in Archivo on a fill
 * that says how it is going. Every letter is an outline from the brand's own
 * font instances (brand/og), so a shield looks the same wherever GitHub
 * shows it, with no font to load.
 *
 * Each shield adapts to the reader's theme by itself: on GitHub's light
 * theme its label sits on Night, on the dark theme on Paper, so it stands
 * out from the page either way. The CodeRabbit shield keeps the system in
 * CodeRabbit's orange and white.
 *
 * `bun run shields` writes them to shields/, and the tests hold the
 * committed files to what this draws.
 */

const brand = join(import.meta.dir, "../../../brand");

type Token = { $value: { components: [number, number, number] } };

function token(name: string): string {
  const color = (tokenFile.color as unknown as Record<string, Token>)[name];
  if (!color) throw new Error(`No color token ${name}`);
  return `#${color.$value.components
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

export const palette = {
  paper: token("paper"),
  ink: token("ink"),
  night: token("night"),
  mist: token("mist"),
  bridge: token("bridge"),
  glow: token("glow"),
  white: "#FFFFFF",
  /** CodeRabbit's brand orange, CR Orange. */
  coderabbit: "#FF570A",
} as const;

/**
 * Status fills, one family: about the same OKLCH lightness (0.545 to 0.57)
 * and a like chroma, so no status shouts over another and each sits well
 * beside the Glow and Bridge slash. Each is as light as it can be while
 * white text on it keeps APCA Lc 77 and WCAG 4.5:1.
 */
export const tones = {
  good: "#1A8641",
  wait: "#A46805",
  bad: "#BF3A39",
  info: "#7258CA",
  idle: "#766F69",
} as const satisfies Record<Tone, string>;

/** The label block, its text and the slash, on each GitHub theme. */
export const themes = {
  light: { ground: palette.night, text: palette.mist, slash: palette.glow },
  dark: { ground: palette.paper, text: palette.ink, slash: palette.bridge },
} as const;

/** CodeRabbit's label: orange and white on either theme. */
export const coderabbitLabel = {
  frame: palette.coderabbit,
  ground: palette.white,
  text: palette.ink,
  slash: palette.coderabbit,
} as const;

export const metrics = {
  height: 24,
  labelSize: 10.5,
  labelTracking: 0.06,
  messageSize: 13,
  /** Padding inside each block, before and after its text. */
  padding: 8,
  /** The slash leans as the a/ mark's does, and is about as heavy. */
  slashLean: 195.46 / 784,
  slashWidth: 3.4,
  /** The page shows through either side of the slash, so it stands apart
   * from any fill beside it. */
  slashGap: 1.2,
  /** The CodeRabbit label's orange frame. */
  frame: 1.5,
  /** The Explain Change shield's arrow. */
  arrowWidth: 11,
  /** The a/ mark's height on the preview shield. */
  markHeight: 13,
} as const;

type Font = fontkit.Font;

export type Fonts = { label: Font; message: Font };

export function loadFonts(): Fonts {
  const open = (file: string) =>
    fontkit.openSync(join(brand, "og", file)) as Font;
  return { label: open("og-meta.ttf"), message: open("og-lead.ttf") };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Rounds every number in an SVG path to hundredths. */
function tidy(d: string): string {
  return d.replace(/-?\d*\.?\d+(e-?\d+)?/g, (n) => String(round(Number(n))));
}

/** A line of text as one outline, its left edge at x and baseline at y. */
function outline(
  font: Font,
  text: string,
  size: number,
  tracking: number,
  x: number,
  y: number,
): { d: string; width: number } {
  const scale = size / font.unitsPerEm;
  const run = font.layout(text);
  let pen = x;
  const parts: string[] = [];
  run.glyphs.forEach((glyph, i) => {
    const d = glyph.path.scale(scale, -scale).translate(pen, y).toSVG();
    if (d) parts.push(d);
    pen += (run.positions[i]?.xAdvance ?? 0) * scale + tracking * size;
  });
  // Tracking only goes between letters.
  const width = pen - x - (text.length > 0 ? tracking * size : 0);
  return { d: tidy(parts.join("")), width };
}

/** The baseline that centers text of this font and size in the shield. */
function baseline(font: Font, size: number, caps: boolean): number {
  const scale = size / font.unitsPerEm;
  const middle = caps ? font.capHeight : (font.capHeight + font.xHeight) / 2;
  return metrics.height / 2 + (middle * scale) / 2;
}

/** The a/ mark's paths, read from the brand kit. */
function markPaths(): { letter: string; slash: string; width: number } {
  const svg = readFileSync(join(brand, "public/mark.svg"), "utf8");
  const view = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const paths = [...svg.matchAll(/<path fill="[^"]+" d="([^"]+)"/g)].map(
    (m) => m[1]!,
  );
  if (!view || paths.length !== 2) throw new Error("Unexpected mark.svg");
  return {
    letter: paths[0]!,
    slash: paths[1]!,
    width: Number(view[1]) / Number(view[2]),
  };
}

const polygon = (points: [number, number][]) =>
  `M${points.map(([x, y]) => `${round(x)} ${round(y)}`).join("L")}Z`;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The label block, the slash and where the second block starts, for a label
 * in either style. The page shows through a hairline either side of the
 * slash, so the slash reads against any fill beside it.
 */
function labelAndSlash(
  text: string,
  style: "allthings" | "coderabbit",
  withMark: boolean,
  fonts: Fonts,
): { parts: string[]; secondStart: number; secondTop: number } {
  const { height: h, padding, slashGap: gap } = metrics;
  const lean = metrics.slashLean * h;
  const coderabbit = style === "coderabbit";

  let x = padding + (coderabbit ? metrics.frame : 0);
  const mark = withMark ? markPaths() : null;
  const markAt = x;
  if (mark) x += mark.width * metrics.markHeight + 5;
  const label = outline(
    fonts.label,
    text.toUpperCase(),
    metrics.labelSize,
    metrics.labelTracking,
    x,
    baseline(fonts.label, metrics.labelSize, true),
  );
  // The slash starts where the label's padding ends, at the bottom edge.
  const slashBottom = label.width + x + padding;
  const slashTop = slashBottom + lean;
  const slashEnd = slashBottom + metrics.slashWidth;

  const labelBlock = polygon([
    [0, 0],
    [slashTop - gap, 0],
    [slashBottom - gap, h],
    [0, h],
  ]);
  const slash = polygon([
    [slashBottom, h],
    [slashTop, 0],
    [slashTop + metrics.slashWidth, 0],
    [slashEnd, h],
  ]);

  const parts: string[] = [];
  if (coderabbit) {
    const f = metrics.frame;
    // The white label sits inside an orange frame beside the orange slash.
    const inner = polygon([
      [f, f],
      [slashTop - gap - f - lean * (f / h), f],
      [slashBottom - gap - f + lean * (f / h), h - f],
      [f, h - f],
    ]);
    parts.push(
      `<path fill="${coderabbitLabel.frame}" d="${labelBlock}"/>`,
      `<path fill="${coderabbitLabel.ground}" d="${inner}"/>`,
      `<path fill="${coderabbitLabel.text}" d="${label.d}"/>`,
      `<path fill="${coderabbitLabel.slash}" d="${slash}"/>`,
    );
  } else {
    parts.push(
      `<path class="g" d="${labelBlock}"/>`,
      `<path class="t" d="${label.d}"/>`,
      `<path class="s" d="${slash}"/>`,
    );
    if (mark) {
      const top = (h - metrics.markHeight) / 2;
      const scale = round((metrics.markHeight / 784) * 1000) / 1000;
      parts.push(
        `<g transform="translate(${round(markAt)} ${round(top)}) scale(${scale})"><path class="t" d="${mark.letter}"/><path class="s" d="${mark.slash}"/></g>`,
      );
    }
  }
  return {
    parts,
    secondStart: slashEnd + gap,
    secondTop: slashTop + metrics.slashWidth + gap,
  };
}

/** A block from just after the slash to the shield's right edge. */
function secondBlock(
  secondStart: number,
  secondTop: number,
  width: number,
): string {
  const h = metrics.height;
  return polygon([
    [secondTop, 0],
    [width, 0],
    [width, h],
    [secondStart, h],
  ]);
}

/** One SVG document around a shield's parts. */
function shieldDocument(
  title: string,
  width: number,
  style: string,
  parts: string[],
) {
  const h = metrics.height;
  const name = escapeXml(title);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}" role="img" aria-label="${name}"><title>${name}</title>${style}${parts.join("")}</svg>\n`;
}

const themeStyle = `<style>.g{fill:${themes.light.ground}}.t{fill:${themes.light.text}}.s{fill:${themes.light.slash}}@media (prefers-color-scheme:dark){.g{fill:${themes.dark.ground}}.t{fill:${themes.dark.text}}.s{fill:${themes.dark.slash}}}</style>`;

/** One status shield as a standalone SVG document. */
export function drawShield(face: Face, fonts: Fonts): string {
  const { padding } = metrics;
  const lean = metrics.slashLean * metrics.height;
  const coderabbit = face.label === "coderabbit";
  const { parts, secondStart, secondTop } = labelAndSlash(
    face.label,
    coderabbit ? "coderabbit" : "allthings",
    face.label === "preview",
    fonts,
  );
  const textStart = secondStart + lean / 2 + padding;
  const message = outline(
    fonts.message,
    face.message,
    metrics.messageSize,
    0,
    textStart,
    baseline(fonts.message, metrics.messageSize, false),
  );
  const width = Math.ceil(textStart + message.width + padding);
  parts.push(
    `<path fill="${tones[face.tone]}" d="${secondBlock(secondStart, secondTop, width)}"/>`,
    `<path fill="${palette.white}" d="${message.d}"/>`,
  );
  return shieldDocument(
    `${face.label}: ${face.message}`,
    width,
    coderabbit ? "" : themeStyle,
    parts,
  );
}

/**
 * The Explain Change shield, which opens CodeRabbit's Change Stack: the
 * CodeRabbit label's orange and white, and an orange block with a white
 * arrow. The arrow is a shape, not text, so CR Orange can hold it: white on
 * it is 3.2:1, past the 3:1 a graphic needs.
 */
export function drawExplainChange(fonts: Fonts): string {
  const { height: h, padding } = metrics;
  const lean = metrics.slashLean * h;
  const { parts, secondStart, secondTop } = labelAndSlash(
    "explain change",
    "coderabbit",
    false,
    fonts,
  );
  const start = secondStart + lean / 2 + padding - 2;
  const width = Math.ceil(start + metrics.arrowWidth + padding);
  const mid = h / 2;
  const end = start + metrics.arrowWidth;
  const stem = 1.1;
  const head = 4.2;
  const arrow = polygon([
    [start, mid - stem],
    [end - head, mid - stem],
    [end - head, mid - head],
    [end, mid],
    [end - head, mid + head],
    [end - head, mid + stem],
    [start, mid + stem],
  ]);
  parts.push(
    `<path fill="${palette.coderabbit}" d="${secondBlock(secondStart, secondTop, width)}"/>`,
    `<path fill="${palette.white}" d="${arrow}"/>`,
  );
  return shieldDocument("Explain Change", width, "", parts);
}

/** Every shield, by file name. */
export function drawAll(
  faces: Face[],
  fonts = loadFonts(),
): Map<string, string> {
  return new Map([
    ...faces.map((face) => [faceFile(face), drawShield(face, fonts)] as const),
    [explainChangeFile, drawExplainChange(fonts)],
  ]);
}
