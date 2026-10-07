import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { colors, tokens } from "../src/tokens.ts";

// The Claude Code plugin (plugins/allthings) draws with the brand's colors:
// its themes and its mod's palette are held to the tokens here, so a token
// that changes moves them too.

const plugin = join(import.meta.dir, "../../plugins/allthings");

const hex = Object.fromEntries(
  colors(tokens).map((color) => [color.name, color.hex.toUpperCase()]),
);

type Theme = {
  name: string;
  base: string;
  overrides: Record<string, string>;
};

async function theme(slug: string): Promise<Theme> {
  return (await Bun.file(
    join(plugin, "themes", `${slug}.json`),
  ).json()) as Theme;
}

describe("the Claude Code plugin's colors", () => {
  test("allthings night is Night's palette: Glow for the accent, Lavender for meta", async () => {
    const night = await theme("allthings-night");
    expect(night.name).toBe("allthings night");
    expect(night.base).toBe("dark");
    expect(night.overrides).toMatchObject({
      claude: hex["glow"],
      text: hex["paper"],
      inactive: hex["lavender"],
      suggestion: hex["lavender"],
      promptBorder: hex["ruleNight"],
      userMessageBackground: hex["nightRaised"],
      selectionBg: hex["ruleNight"],
    });
  });

  test("allthings paper is Paper's palette: Ink text, Bridge for the accent", async () => {
    const paper = await theme("allthings-paper");
    expect(paper.name).toBe("allthings paper");
    expect(paper.base).toBe("light");
    expect(paper.overrides).toMatchObject({
      claude: hex["bridge"],
      text: hex["ink"],
      inactive: hex["karlText"],
      suggestion: hex["violet"],
      promptBorder: hex["rulePaper"],
      userMessageBackground: hex["karl"],
      selectionBg: hex["rulePaper"],
    });
  });

  test("the mod's palette is the tokens' own", async () => {
    const source = await Bun.file(join(plugin, "hooks/palette.ts")).text();
    const palette = Object.fromEntries(
      [...source.matchAll(/export const (\w+) = "(#[0-9A-F]{6})";/g)].map(
        ([, name, value]) => [name, value],
      ),
    );
    expect(palette).toEqual({
      NIGHT: hex["night"],
      PAPER: hex["paper"],
      INK: hex["ink"],
      BRIDGE: hex["bridge"],
      GLOW: hex["glow"],
      LAVENDER: hex["lavender"],
      DUSK: hex["dusk"],
      VIOLET: hex["violet"],
    });
  });
});
