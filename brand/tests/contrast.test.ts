import { describe, expect, test } from "bun:test";
import { apcaContrast, textFloor } from "../src/contrast.ts";
import { dimension, tokens } from "../src/tokens.ts";

describe("the smallest text a contrast carries", () => {
  test("follows the APCA targets in foundations.md", () => {
    expect([90, 75, 74.9, 60, 59.9, 45, 44.9, 0].map(textFloor)).toEqual([
      "small",
      "small",
      "large",
      "large",
      "display",
      "display",
      undefined,
      undefined,
    ]);
    // Light text on dark grounds is negative; only the magnitude counts.
    expect(textFloor(-80)).toBe("small");
  });

  test("names sizes the tokens hold: 24px for Lc 60, 36px for Lc 45", () => {
    expect(dimension(tokens, "fontSize", "large").px).toBe(24);
    expect(dimension(tokens, "fontSize", "display").px).toBe(36);
  });

  test("keeps Glow on Night to display sizes, as the brand says", () => {
    expect(textFloor(apcaContrast("#FF6A3D", "#1B1729"))).toBe("display");
  });
});
