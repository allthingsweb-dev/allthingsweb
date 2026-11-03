import { describe, expect, test } from "bun:test";
import manifest from "../dist/build.json" with { type: "json" };

/**
 * "Archivo Fallback" in the built stylesheets (scripts/build.ts): until
 * Archivo arrives, text is set in Arial sized to Archivo's width and with
 * its ascent and descent, at every width and weight the site sets, so the
 * swap moves nothing.
 */

const built = (path: string) =>
  Bun.file(new URL(`../dist/public${path}`, import.meta.url)).text();
const site = await built(manifest.stylesheet);
const lab = await built(manifest.labStylesheet);

/** Archivo's ascent, descent and line gap, in ems (its hhea and OS/2 tables). */
const archivo = { ascent: 0.878, descent: 0.21, lineGap: 0 };

/** Each `@font-face` rule's descriptors, by name. */
const fontFaces = (css: string) =>
  [...css.matchAll(/@font-face\{([^}]*)\}/g)].map(
    ([, body = ""]) =>
      new Map(
        body.split(";").map((declaration) => {
          const colon = declaration.indexOf(":");
          return [
            declaration.slice(0, colon).trim(),
            declaration.slice(colon + 1).trim(),
          ] as const;
        }),
      ),
  );

const fallback = fontFaces(site).filter(
  (face) => face.get("font-family") === "Archivo Fallback",
);

/** A CSS percentage as a fraction. */
const fraction = (value: string | undefined): number => {
  expect(value).toMatch(/^\d+(\.\d+)?%$/);
  return Number.parseFloat(value ?? "") / 100;
};

/** Every width a rule sets text at, outside `@font-face`, and the default. */
const widthsSet = (css: string) => [
  "100%",
  ...[
    ...css
      .replace(/@font-face\{[^}]*\}/g, "")
      .matchAll(/font-stretch:\s*([^;}]+)/g),
  ].map(([, width = ""]) => width.trim()),
];

describe("Archivo Fallback", () => {
  test("follows Archivo in the display stack", () => {
    expect(site).toContain(
      '--at-font-display:Archivo,"Archivo Fallback",sans-serif',
    );
  });

  test("has a face for each width the site sets, below 600 and from 600", () => {
    const faces = fallback.map(
      (face) => `${face.get("font-stretch")} ${face.get("font-weight")}`,
    );
    const widths = [...new Set([...widthsSet(site), ...widthsSet(lab)])];
    expect(widths.toSorted()).toEqual(["100%", "112%", "75%"]);
    expect(faces.toSorted()).toEqual(
      widths
        .flatMap((width) => [`${width} 100 599`, `${width} 600 900`])
        .toSorted(),
    );
  });

  test("is Arial, or a face with its metrics, and Arial Bold from 600", () => {
    for (const face of fallback) {
      expect(face.get("font-style")).toBe("normal");
      expect(face.get("src")).toBe(
        face.get("font-weight") === "600 900"
          ? "local(Arial Bold),local(Arial-BoldMT),local(Liberation Sans Bold),local(Arimo Bold)"
          : "local(Arial),local(ArialMT),local(Liberation Sans),local(Arimo)",
      );
    }
  });

  test("sets each line at Archivo's height and baseline, at any size", () => {
    for (const face of fallback) {
      // Chrome scales the overrides by size-adjust, as the spec says.
      const size = fraction(face.get("size-adjust"));
      expect(size).toBeGreaterThan(0.5);
      expect(size).toBeLessThan(1.5);
      expect(fraction(face.get("ascent-override")) * size).toBeCloseTo(
        archivo.ascent,
        3,
      );
      expect(fraction(face.get("descent-override")) * size).toBeCloseTo(
        archivo.descent,
        3,
      );
      expect(fraction(face.get("line-gap-override")) * size).toBeCloseTo(
        archivo.lineGap,
        3,
      );
    }
  });
});
