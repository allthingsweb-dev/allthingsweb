import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import source from "../all-things.tokens.json" with { type: "json" };
import { expandCustomMedia, length, themeCss } from "../src/css.ts";
import { below, contentVw, portrait, sizes } from "../src/layout.ts";
import {
  dimensionGroups,
  dimensions,
  measures,
  TokenFile,
  tokens,
  typeRoles,
} from "../src/tokens.ts";

describe("the layout tokens", () => {
  test("give every group lengths, and every length a description", () => {
    for (const group of dimensionGroups) {
      expect(dimensions(tokens, group).length).toBeGreaterThan(0);
      for (const token of dimensions(tokens, group)) {
        expect(token.px).toBeGreaterThan(0);
        expect(token.description.length).toBeGreaterThan(0);
      }
    }
    expect(measures(tokens).map((measure) => measure.name)).toEqual([
      "prose",
      "lead",
      "statement",
    ]);
  });

  test("keep the spacing scale on a 4px step", () => {
    for (const step of dimensions(tokens, "space")) {
      expect(step.px).toBe(Number(step.name) * 4);
    }
  });

  test("list the breakpoints from narrowest to widest, all below the page", () => {
    const widths = dimensions(tokens, "breakpoint").map(({ px }) => px);
    expect(widths).toEqual(widths.toSorted((a, b) => a - b));
    expect(Math.max(...widths)).toBeLessThan(
      dimensions(tokens, "layout").find(({ name }) => name === "page")?.px ?? 0,
    );
  });

  test("never let a fluid length shrink below its floor or past its size", () => {
    for (const group of dimensionGroups) {
      for (const { fluid, px } of dimensions(tokens, group)) {
        if (fluid !== undefined && "min" in fluid && fluid.min !== undefined) {
          expect(fluid.min.value).toBeLessThan(px);
        }
      }
    }
  });

  test("leave the ledger's content most of the grid", () => {
    const decode = Schema.decodeUnknownExit(TokenFile);
    const file = structuredClone(source);
    for (const labels of [6, 11, 12]) {
      file.$extensions["dev.allthings"].ledgerColumns = labels;
      expect(decode(file)._tag).toBe("Failure");
    }
    file.$extensions["dev.allthings"].ledgerColumns = 5;
    expect(decode(file)._tag).toBe("Success");
  });

  test("reject a fluid length with neither a viewport nor a container share", () => {
    const decode = Schema.decodeUnknownExit(TokenFile);
    const file = structuredClone(source);
    file.layout.margin.$extensions["dev.allthings"].fluid = {
      min: { value: 16, unit: "px" },
    } as never;
    expect(decode(file)._tag).toBe("Failure");
  });
});

describe("a length as CSS", () => {
  test("is its size, or the clamp or min that narrows it", () => {
    expect(length({ px: 24, fluid: undefined })).toBe("24px");
    expect(
      length({
        px: 64,
        fluid: { min: { value: 16, unit: "px" }, viewport: 4.5 },
      }),
    ).toBe("clamp(16px, 4.5vw, 64px)");
    expect(length({ px: 72, fluid: { viewport: 12 } })).toBe("min(72px, 12vw)");
    expect(length({ px: 112, fluid: { container: 15.5 } })).toBe(
      "min(112px, 15.5cqi)",
    );
  });
});

describe("the theme's layout", () => {
  const css = themeCss(tokens);

  test("declares every length once, on :root", () => {
    for (const group of dimensionGroups.filter(
      (name) => name !== "breakpoint",
    )) {
      for (const token of dimensions(tokens, group)) {
        const name = `--at-${group.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}-${token.name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}: `;
        expect(css.split(name)).toHaveLength(2);
      }
    }
    expect(css).toContain("--at-layout-margin: clamp(16px, 4.5vw, 64px);");
    expect(css).toContain("--at-measure-prose: 68ch;");
    expect(css).toContain("--at-ledger-label: 3;");
    expect(css).toContain("--at-ledger-content: 9;");
  });

  test("sizes each type role through its own custom property", () => {
    for (const role of typeRoles(tokens)) {
      const kebab = role.name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      expect(css).toContain(
        `.at-type-${kebab} {\n  font-family: var(--at-font-${role.family});\n  font-size: var(--at-type-${kebab}-size);`,
      );
    }
    expect(css).toContain("--at-type-lead-size: clamp(22px, 3vw, 30px);");
    expect(css).toContain("--at-type-body-size: 18px;");
  });

  test("names each breakpoint as a custom media query", () => {
    for (const { name, px } of dimensions(tokens, "breakpoint")) {
      expect(css).toContain(
        `@custom-media --at-below-${name} (max-width: ${px - 0.02}px);`,
      );
    }
  });
});

describe("custom media queries", () => {
  test("expand where @media names them, and their definitions go", () => {
    const css = expandCustomMedia(
      [
        "@custom-media --at-below-l (max-width: 767.98px);",
        "@media (--at-below-l) {",
        "  .a {",
        "    display: none;",
        "  }",
        "}",
        "@media (prefers-reduced-motion: reduce) and (--at-below-l) {}",
      ].join("\n"),
    );
    expect(css).not.toContain("@custom-media");
    expect(css).toContain("@media (max-width: 767.98px) {");
    expect(css).toContain(
      "@media (prefers-reduced-motion: reduce) and (max-width: 767.98px) {}",
    );
  });

  test("fail on a name nobody defined", () => {
    expect(() => expandCustomMedia("@media (--at-below-q) {}")).toThrow(
      "No custom media --at-below-q",
    );
  });

  test("leave the theme with none unexpanded", () => {
    const css = expandCustomMedia(themeCss(tokens));
    expect(css).not.toMatch(/@custom-media|@media[^{]*\(--/);
  });
});

describe("image sizes from the layout", () => {
  test("follow the stylesheet's breakpoints", () => {
    expect(below("l")).toBe("(max-width: 767.98px)");
  });

  test("give a share of the grid's columns as the margins narrow, and at its widest", () => {
    // The ledger's photos: a third of 9 of 12 columns, 12px apart; half the
    // page below the large breakpoint.
    expect(contentVw).toBe(91);
    expect(
      sizes(
        { span: 9, parts: 3, gap: 12 },
        { below: "l", span: 12, parts: 2, gap: 12 },
      ),
    ).toBe(
      "(max-width: 767.98px) calc(45.5vw - 6px), (max-width: 1439.98px) calc(22.75vw - 10px), 318px",
    );
  });

  test("give portraits their token sizes", () => {
    expect(portrait).toEqual({ xs: 36, s: 44, m: 72, l: 96, xl: 168 });
  });
});

describe("optical insets", () => {
  const css = themeCss(tokens);

  test("pull every role's letters back by its face's measured bearing", () => {
    for (const role of typeRoles(tokens)) {
      const kebab = role.name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      expect(role.inset).toBeGreaterThan(0);
      expect(role.inset).toBeLessThan(0.1);
      expect(css).toContain(`--at-type-${kebab}-inset: -${role.inset}em;`);
      expect(css).toContain(`text-indent: var(--at-type-${kebab}-inset);`);
    }
  });
});
