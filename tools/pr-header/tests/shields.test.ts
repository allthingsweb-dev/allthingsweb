import { describe, expect, test } from "bun:test";
import { apcaContrast, wcagContrast } from "../../../brand/src/contrast.ts";
import { allFaces, faceFile, labels } from "../src/faces.ts";
import {
  coderabbitLabel,
  drawShield,
  loadFonts,
  palette,
  themes,
  tones,
} from "../src/shields.ts";
import { committedShields, expectedShields } from "../src/write-shields.ts";

const fonts = loadFonts();
const faces = allFaces();

describe("the committed shields", () => {
  test("are exactly what the renderer draws (bun run shields)", () => {
    const expected = expectedShields();
    const committed = committedShields();
    expect([...committed.keys()].toSorted()).toEqual(
      [...expected.keys()].toSorted(),
    );
    for (const [file, text] of expected) {
      expect({ file, text: committed.get(file) }).toEqual({ file, text });
    }
  });

  test("cover every label, each face once", () => {
    expect(new Set(faces.map((face) => face.label))).toEqual(new Set(labels));
    const files = faces.map(faceFile);
    expect(new Set(files).size).toBe(files.length);
  });
});

describe("a shield", () => {
  const ready = drawShield(
    { label: "merge", message: "ready", tone: "good" },
    fonts,
  );

  test("is a self-contained SVG that names its status for screen readers", () => {
    expect(ready).toStartWith('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(ready).toContain('role="img" aria-label="merge: ready"');
    expect(ready).toContain("<title>merge: ready</title>");
    // Outlines only: nothing to fetch, no font, no script, no link.
    expect(ready).not.toMatch(/<text|<image|<script|href=|url\(|@import/);
  });

  test("is 24px tall and as wide as its words", () => {
    const size = (svg: string) =>
      /width="(\d+)" height="(\d+)"/.exec(svg)!.slice(1).map(Number);
    expect(size(ready)[1]).toBe(24);
    const long = drawShield(
      { label: "merge", message: "checks not green", tone: "wait" },
      fonts,
    );
    expect(size(long)[0]!).toBeGreaterThan(size(ready)[0]! + 50);
  });

  test("puts its label on Night in light themes and on Paper in dark ones", () => {
    expect(ready).toContain(
      `<style>.g{fill:${palette.night}}.t{fill:${palette.mist}}.s{fill:${palette.glow}}@media (prefers-color-scheme:dark){.g{fill:${palette.paper}}.t{fill:${palette.ink}}.s{fill:${palette.bridge}}}</style>`,
    );
  });

  test("fills its status by tone", () => {
    expect(ready).toContain(`fill="${tones.good}"`);
  });

  test("for CodeRabbit is orange and white on either theme", () => {
    const coderabbit = drawShield(
      { label: "coderabbit", message: "approved", tone: "good" },
      fonts,
    );
    expect(coderabbit).not.toContain("<style>");
    expect(coderabbit).toContain(`fill="${palette.coderabbit}"`);
    expect(coderabbit).toContain(`fill="${palette.white}"`);
  });

  test("for the preview carries the a/ mark", () => {
    const preview = drawShield(
      { label: "preview", message: "ready", tone: "good" },
      fonts,
    );
    expect(preview).toContain("<g transform=");
    expect(ready).not.toContain("<g transform=");
  });

  test("escapes its words in markup", () => {
    const svg = drawShield(
      { label: "merge", message: "a<b & c", tone: "idle" },
      fonts,
    );
    expect(svg).toContain('aria-label="merge: a&lt;b &amp; c"');
  });

  test("draws the same way every time", () => {
    for (const face of faces.slice(0, 5)) {
      expect(drawShield(face, fonts)).toBe(drawShield(face, loadFonts()));
    }
  });
});

describe("shield colors", () => {
  // Brand rule: small text at APCA Lc 75 or more, and WCAG 2.2 AA (4.5:1).
  const legible = (text: string, ground: string) => {
    expect(Math.abs(apcaContrast(text, ground))).toBeGreaterThanOrEqual(75);
    expect(wcagContrast(text, ground)).toBeGreaterThanOrEqual(4.5);
  };

  test.each(Object.entries(tones))(
    "%s keeps white status text legible",
    (_tone, fill) => legible(palette.white, fill),
  );

  test.each(Object.entries(themes))(
    "the %s theme's label is legible",
    (_theme, { text, ground }) => legible(text, ground),
  );

  test("CodeRabbit's label is legible", () => {
    legible(coderabbitLabel.text, coderabbitLabel.ground);
  });

  test("the slash follows the brand: Glow on Night, Bridge on Paper", () => {
    expect(themes.light).toMatchObject({
      ground: palette.night,
      slash: palette.glow,
    });
    expect(themes.dark).toMatchObject({
      ground: palette.paper,
      slash: palette.bridge,
    });
  });
});
