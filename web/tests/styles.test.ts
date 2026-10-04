import { describe, expect, test } from "bun:test";
import { themeCss } from "allthings-brand/src/css.ts";
import { tokens } from "allthings-brand/src/tokens.ts";

/**
 * The site's own rules color only through the theme's roles, whose
 * pairings the brand's tests hold to their APCA targets in both modes.
 */

const site = await Bun.file(
  new URL("../src/styles/site.css", import.meta.url),
).text();
const theme = themeCss(tokens);

describe("site.css", () => {
  test("names no color of its own", () => {
    expect(site).not.toMatch(
      /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|lab|lch|oklch|oklab|color)\(/i,
    );
    expect(site).not.toMatch(
      /(?:^|[\s:])(?:white|black|red|orange|purple|gray|grey|transparent|currentcolor)\s*[;!]/im,
    );
  });

  test("uses only custom properties the theme defines", () => {
    const used = new Set(
      [...site.matchAll(/var\((--at-[a-z-]+)\)/g)].map(([, name]) => name),
    );
    expect(used.size).toBeGreaterThan(5);
    for (const name of used) expect(theme).toContain(`${name}:`);
  });
});
