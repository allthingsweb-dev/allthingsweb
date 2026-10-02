import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { APCAcontrast, sRGBtoY } from "apca-w3";
import {
  colorHexes,
  generateCss,
  generateFiles,
  referencedName,
  tokenFileSchema,
} from "../src/brand/generate";

const brandDir = join(import.meta.dir, "../src/brand");
const tokens = tokenFileSchema.parse(
  await Bun.file(join(brandDir, "all-things.tokens.json")).json(),
);
const hexes = colorHexes(tokens);

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

describe("all things/_ design tokens", () => {
  test("keep the locked palette", () => {
    expect(hexes).toMatchObject({
      paper: "#F4F1EC",
      ink: "#141210",
      bridge: "#C0362C",
      bridgeDeep: "#9A2B22",
      violet: "#5B34D6",
      night: "#1C1236",
      lavender: "#DACFFF",
      glow: "#FF6A3D",
    });
  });

  test.each(tokens.$extensions["dev.allthings"].contrast)(
    "$use meets APCA Lc $minLc",
    ({ text, background, minLc }) => {
      const lc = APCAcontrast(
        sRGBtoY(rgb(hexes[referencedName(text)]!)),
        sRGBtoY(rgb(hexes[referencedName(background)]!)),
      );
      expect(Math.abs(lc)).toBeGreaterThanOrEqual(minLc);
    },
  );

  test("every type role references a defined font", () => {
    for (const [name, token] of Object.entries(tokens.type)) {
      if (name === "$type" || typeof token === "string") continue;
      expect(tokens.font).toHaveProperty(
        referencedName(token.$value.fontFamily),
      );
    }
  });

  test("rejects references into the wrong group or to undefined tokens", async () => {
    const source = await Bun.file(
      join(brandDir, "all-things.tokens.json"),
    ).json();
    const withRole = (fontFamily: string) =>
      structuredClone({
        ...source,
        type: {
          ...source.type,
          wordmark: {
            ...source.type.wordmark,
            $value: { ...source.type.wordmark.$value, fontFamily },
          },
        },
      });
    const withContrast = (text: string) => {
      const file = structuredClone(source);
      file.$extensions["dev.allthings"].contrast[0].text = text;
      return file;
    };
    for (const file of [
      withRole("{color.ink}"),
      withRole("{font.serif}"),
      withContrast("{font.display}"),
      withContrast("{color.chartreuse}"),
    ]) {
      expect(tokenFileSchema.safeParse(file).success).toBe(false);
    }
  });

  test("the generated theme and constants are up to date", async () => {
    for (const [name, contents] of Object.entries(
      await generateFiles(tokens),
    )) {
      expect(await Bun.file(join(brandDir, name)).text()).toBe(contents);
    }
  });

  test("the theme only applies inside the rebrand scope", () => {
    const css = generateCss(tokens);
    const rules = css
      .split("\n")
      .filter(
        (line) =>
          line.endsWith("{") && !line.startsWith("@") && !line.startsWith("  "),
      );
    expect(
      rules.every((rule) => rule.startsWith('[data-brand="allthings"]')),
    ).toBe(true);
  });
});
