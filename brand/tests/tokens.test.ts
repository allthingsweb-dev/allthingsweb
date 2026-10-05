import { describe, expect, test } from "bun:test";
import { APCAcontrast, sRGBtoY } from "apca-w3";
import { Schema } from "effect";
import source from "../all-things.tokens.json" with { type: "json" };
import { apcaContrast, rgb, wcagContrast } from "../src/contrast.ts";
import { themeCss } from "../src/css.ts";
import {
  colors,
  contrastRequirements,
  modes,
  themeRoles,
  TokenFile,
  tokens,
} from "../src/tokens.ts";

const hexes = Object.fromEntries(
  colors(tokens).map((color) => [color.name, color.hex]),
);

describe("all things/_ design tokens", () => {
  test("keep the locked palette", () => {
    expect(hexes).toMatchObject({
      paper: "#F4F1EC",
      ink: "#141210",
      bridge: "#C0362C",
      bridgeDeep: "#9A2B22",
      violet: "#5B34D6",
      karlText: "#5E5A55",
      night: "#1B1729",
      mist: "#E3DCF7",
      dusk: "#D9D3E0",
      lavender: "#DACFFF",
      glow: "#FF6A3D",
    });
  });

  test.each([...contrastRequirements(tokens)])(
    "$use meets its APCA target",
    ({ text, background, minLc }) => {
      expect(
        Math.abs(apcaContrast(text.hex, background.hex)),
      ).toBeGreaterThanOrEqual(minLc);
    },
  );

  // APCA guides the design; WCAG 2.2 AA is still the standard, so every pair
  // must clear its text minimum too.
  test.each([...contrastRequirements(tokens)])(
    "$use meets WCAG 2.2 AA (4.5:1)",
    ({ text, background }) => {
      expect(wcagContrast(text.hex, background.hex)).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );

  test("APCA matches the reference implementation for every pair of colors", () => {
    const y = (hex: string) => sRGBtoY(rgb(hex));
    for (const text of colors(tokens)) {
      for (const ground of colors(tokens)) {
        expect(apcaContrast(text.hex, ground.hex)).toBeCloseTo(
          APCAcontrast(y(text.hex), y(ground.hex)),
          9,
        );
      }
    }
  });

  // Each mode's text roles are pairings the contrast list checks, so no page
  // can set text in a role that fails its target.
  for (const mode of modes) {
    test(`${mode}'s text roles are pairings with a contrast target`, () => {
      const role = (name: string) =>
        themeRoles(tokens, mode).find((candidate) => candidate.name === name)
          ?.color.name;
      const pairs = [
        ["text", "ground"],
        ["meta", "ground"],
        ["link", "ground"],
        ["slash", "ground"],
        ["buttonText", "button"],
      ] as const;
      const checked = contrastRequirements(tokens).map(
        (pair) => `${pair.text.name} on ${pair.background.name}`,
      );
      for (const [text, ground] of pairs) {
        expect(checked).toContain(`${role(text)} on ${role(ground)}`);
      }
    });
  }

  test("brand/foundations.md quotes the palette and its contrast exactly", async () => {
    const foundations = await Bun.file(
      new URL("../foundations.md", import.meta.url),
    ).text();
    const rows = foundations
      .split("\n")
      .filter((line) =>
        /^\| [A-Z][a-z]+( [A-Za-z]+)? \| #[0-9A-F]{6} \|/.test(line),
      )
      .map((line) => line.split("|").map((cell) => cell.trim()));
    expect(rows.length).toBeGreaterThanOrEqual(13);
    const byName = new Map(
      colors(tokens).map((color) => [color.name.toLowerCase(), color.hex]),
    );
    const quoted = (text: string, ground: string) =>
      `Lc ${Math.abs(apcaContrast(text, ground)).toFixed(1)} · ${wcagContrast(text, ground).toFixed(1)}:1`;
    for (const [, name = "", hex = "", onPaper = "", onNight = ""] of rows) {
      expect(byName.get(name.replaceAll(" ", "").toLowerCase())).toBe(hex);
      if (onPaper !== "—") expect(onPaper).toBe(quoted(hex, hexes["paper"]!));
      if (onNight !== "—") expect(onNight).toBe(quoted(hex, hexes["night"]!));
    }
  });

  test("rejects references to tokens that don't exist or are in another group", () => {
    const decode = Schema.decodeUnknownExit(TokenFile);
    const withFont = (fontFamily: string) => {
      const file = structuredClone(source);
      file.type.wordmark.$value.fontFamily = fontFamily;
      return file;
    };
    const withContrast = (text: string) => {
      const file = structuredClone(source);
      const [first] = file.$extensions["dev.allthings"].contrast;
      if (first !== undefined) first.text = text;
      return file;
    };
    const withRole = (value: string) => {
      const file = structuredClone(source);
      file.theme.night.link.$value = value;
      return file;
    };
    const withoutNightRole = () => {
      const file = structuredClone(source);
      const { link: _, ...night } = file.theme.night;
      return { ...file, theme: { ...file.theme, night } };
    };
    expect(decode(source)._tag).toBe("Success");
    for (const file of [
      withFont("{color.ink}"),
      withFont("{font.serif}"),
      withContrast("{font.display}"),
      withContrast("{color.chartreuse}"),
      withRole("{color.chartreuse}"),
      withoutNightRole(),
    ]) {
      expect(decode(file)._tag).toBe("Failure");
    }
  });

  test("rejects a token where a group's $type belongs, and the reverse", () => {
    const decode = Schema.decodeUnknownExit(TokenFile);
    const file = structuredClone(source);
    expect(
      decode({ ...file, color: { ...file.color, $type: "dimension" } })._tag,
    ).toBe("Failure");
    expect(
      decode({ ...file, color: { ...file.color, bridge: "color" } })._tag,
    ).toBe("Failure");
  });
});

describe("the theme CSS", () => {
  const css = themeCss(tokens);

  test("declares every palette color once, on :root", () => {
    for (const color of colors(tokens)) {
      const kebab = color.name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      expect(css.split(`--at-color-${kebab}: `)).toHaveLength(2);
    }
  });

  test("defaults to Paper, and follows the system or data-theme to Night", () => {
    expect(css).toContain(
      ':root,\n[data-theme="light"] {\n  color-scheme: light;',
    );
    expect(css).toContain('[data-theme="dark"] {\n  color-scheme: dark;');
    expect(css).toContain(
      '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n    color-scheme: dark;',
    );
  });

  test("gives Night its texture in every place Night applies, and Paper none", () => {
    const textured = themeCss(tokens, { night: "/assets/grain.svg" });
    const night = '--at-texture: url("/assets/grain.svg");';
    expect(textured.split(night)).toHaveLength(3);
    expect(textured).toContain(
      ':root,\n[data-theme="light"] {\n  color-scheme: light;\n  --at-texture: none;',
    );
    expect(textured).toContain(
      `[data-theme="dark"] {\n  color-scheme: dark;\n  ${night}`,
    );
    expect(css).not.toContain("url(");
  });

  test("stops the cursor for people who prefer reduced motion", () => {
    expect(css).toContain(
      "@media (prefers-reduced-motion: reduce) {\n  .at-cursor {\n    animation: none;",
    );
  });
});
