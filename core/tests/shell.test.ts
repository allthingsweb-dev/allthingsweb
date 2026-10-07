import { describe, expect, test } from "bun:test";
import { shellWord } from "../scripts/shell.ts";

/** The commands the scripts print for an organizer to paste (scripts/shell.ts). */
describe("shellWord", () => {
  test("leaves a safe word as it is and quotes anything else as one word", () => {
    expect(shellWord("Acme")).toBe("Acme");
    expect(shellWord("/logos/acme-dark.png")).toBe("/logos/acme-dark.png");
    expect(shellWord("Acme Inc.")).toBe("'Acme Inc.'");
    expect(shellWord("it's $HOME `x`")).toBe("'it'\\''s $HOME `x`'");
    expect(shellWord("")).toBe("''");
  });
});
