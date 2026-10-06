import { describe, expect, test } from "bun:test";
import { themeCss } from "allthings-brand/src/css.ts";
import { tokens } from "allthings-brand/src/tokens.ts";

/**
 * The site's own rules color only through the theme's roles, whose
 * pairings the brand's tests hold to their APCA targets in both modes, and
 * size and space only through the layout tokens, so a one-off length, a
 * magic width or a breakpoint of a page's own fails the build.
 */

const site = await Bun.file(
  new URL("../src/styles/site.css", import.meta.url),
).text();
const theme = themeCss(tokens);

/** CSS Color 4's named colors, plus the keywords that also pick a color. */
const namedColors = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black
  blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse
  chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan
  darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta
  darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
  darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink
  deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen
  fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey
  honeydew hotpink indianred indigo ivory khaki lavender lavenderblush
  lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow
  lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen
  lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime
  limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid
  mediumpurple mediumseagreen mediumslateblue mediumspringgreen
  mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
  navajowhite navy oldlace olive olivedrab orange orangered orchid
  palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff
  peru pink plum powderblue purple rebeccapurple red rosybrown royalblue
  saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue
  slateblue slategray slategrey snow springgreen steelblue tan teal thistle
  tomato turquoise violet wheat white whitesmoke yellow yellowgreen
  transparent currentcolor accentcolor accentcolortext activetext buttonborder
  buttonface buttontext canvas canvastext field fieldtext graytext highlight
  highlighttext linktext mark marktext selecteditem selecteditemtext
  visitedtext`.split(/\s+/),
);

/** Each declaration's value, without comments, strings or custom properties. */
const values = [
  ...site
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .matchAll(/(?:^|[{;])\s*(-?[a-z][a-z-]*)\s*:([^;{}]*)/gm),
].map(([, property = "", value = ""]) => ({ property, value }));

describe("site.css", () => {
  test("is read declaration by declaration", () => {
    expect(values.length).toBeGreaterThan(100);
    expect(values).toContainEqual({
      property: "color",
      value: " var(--at-link)",
    });
  });

  test("names no color of its own", () => {
    for (const { property, value } of values) {
      const declaration = `${property}:${value}`;
      expect(declaration).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(declaration).not.toMatch(
        /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|device-cmyk)\(/i,
      );
      const words = value
        .replace(/var\([^)]*\)/g, "")
        .toLowerCase()
        .match(/[a-z][a-z-]*/g);
      for (const word of words ?? []) {
        expect(namedColors.has(word) ? declaration : word).toBe(word);
      }
    }
  });

  test("uses only custom properties the theme defines", () => {
    const used = new Set(
      [...site.matchAll(/var\((--at-[a-z0-9-]+)\)/g)].map(([, name]) => name),
    );
    expect(used.size).toBeGreaterThan(5);
    for (const name of used) expect(theme).toContain(`${name}:`);
  });
});

/** A length: a number and a unit; `%` and `fr` are shares, not lengths. */
const lengths =
  /(?<![\w-])-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|ex|ch|lh|rlh|vw|vh|vi|vb|vmin|vmax|[sld]v[whib]|cq[whib]|cqmin|cqmax|in|cm|mm|pt|pc|q)\b/gi;

/** The lengths in a value, outside the custom properties it reads. */
const lengthsIn = (value: string): ReadonlyArray<string> =>
  value.replace(/var\(--[a-z0-9-]+\)/g, "").match(lengths) ?? [];

/** The one length a page may write itself: a hairline, as `.visually-hidden` is. */
const hairline = "1px";

/** What may follow the type in em: its tracking, underline offset and size. */
const typeRelative = /^(?:letter-spacing|text-underline-offset|font-size)$/;

/** What sets a box's size, or a grid's tracks. */
const sizing =
  /^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|flex-basis|grid-(?:template|auto)-(?:columns|rows))$/;

/** A length in em, and not in rem. */
const em = /^-?(?:\d+(?:\.\d+)?|\.\d+)em$/;

/** The declarations' lengths that come from no token: all but a hairline and type-relative em. */
const looseLengths = (
  declarations: ReadonlyArray<{ property: string; value: string }>,
): ReadonlyArray<string> =>
  declarations.flatMap(({ property, value }) =>
    lengthsIn(value)
      .filter((length) => length !== hairline)
      .filter((length) => !(em.test(length) && typeRelative.test(property)))
      .map((length) => `${property}: ${length}`),
  );

/**
 * A margin made only of 0, auto and spacing tokens, which are positive: it
 * can't pull a box back over its neighbor, whatever arithmetic would do.
 */
const isTokenMargin = (value: string): boolean =>
  value
    .trim()
    .split(/\s+/)
    .every((part) => /^(?:0|auto|var\(--at-space-[0-9]+\))$/.test(part));

describe("site.css's lengths", () => {
  test("come from the layout tokens, but for a hairline and type-relative em", () => {
    expect(looseLengths(values)).toEqual([]);
  });

  test("are caught in rem, and in em outside the type", () => {
    expect(
      looseLengths([
        { property: "font-size", value: " 2rem" },
        { property: "margin", value: " 100em" },
        { property: "letter-spacing", value: " -0.03em" },
        { property: "border", value: " 1px solid var(--at-rule)" },
      ]),
    ).toEqual(["font-size: 2rem", "margin: 100em"]);
  });

  test("size boxes with no width of their own", () => {
    const magic = values.flatMap(({ property, value }) =>
      sizing.test(property)
        ? [
            ...value
              .replace(/var\(--[a-z0-9-]+\)/g, "")
              .matchAll(/(?<![\w-])\d*\.?\d+([a-z%]+)/gi),
          ]
            .map(([length = ""]) => length)
            .filter(
              (length) =>
                length !== hairline &&
                length !== "100%" &&
                !length.endsWith("fr"),
            )
            .map((length) => `${property}: ${length}`)
        : [],
    );
    expect(magic).toEqual([]);
  });

  test("never pull a box over its neighbor: margins are 0, auto or a token", () => {
    // Portraits side by side, never stacked: every host is always seen.
    const pulled = values.filter(
      ({ property, value }) =>
        property.startsWith("margin") && !isTokenMargin(value),
    );
    expect(pulled).toEqual([]);
  });

  test("tell a token margin from one that could pull back", () => {
    for (const value of [
      " 0",
      " 0 auto",
      " var(--at-space-1) 0 0",
      " auto 0",
    ]) {
      expect(isTokenMargin(value)).toBe(true);
    }
    for (const value of [
      " -4px",
      " calc(-1 * var(--at-space-2))",
      " calc(0px - 2px)",
      " calc(0px - var(--at-space-2))",
      " 0 -1em",
    ]) {
      expect(isTokenMargin(value)).toBe(false);
    }
  });

  test("define no custom properties of their own", () => {
    expect(site.match(/(?:^|[{;])\s*--[a-z0-9-]+\s*:/gm)).toBeNull();
  });

  test("break only at the tokens' breakpoints", () => {
    const preludes = [...site.matchAll(/@media([^{]*)\{/g)].map(
      ([, prelude = ""]) => prelude.trim(),
    );
    expect(preludes.length).toBeGreaterThan(2);
    for (const prelude of preludes) {
      for (const [, name] of prelude.matchAll(/\((--[a-z0-9-]+)\)/g)) {
        expect(theme).toContain(`@custom-media ${name} `);
      }
      expect(prelude.replace(/\(--[a-z0-9-]+\)/g, "")).not.toMatch(/\d/);
    }
  });
});

describe("the pages", () => {
  test("set no inline style: every rule is in site.css", async () => {
    const styled: Array<string> = [];
    for await (const path of new Bun.Glob("src/**/*.{ts,tsx}").scan({
      cwd: new URL("..", import.meta.url).pathname,
    })) {
      const source = await Bun.file(
        new URL(`../${path}`, import.meta.url),
      ).text();
      if (/\sstyle=|[\s{,]style:\s|setAttribute\(\s*["']style/.test(source)) {
        styled.push(path);
      }
    }
    expect(styled).toEqual([]);
  });
});

/** site.css's rules, selector by selector. */
const rules = [
  ...site.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g),
].map(([, selector = "", body = ""]) => ({ selector: selector.trim(), body }));

describe("display type", () => {
  test("is pulled back to the box's edge by its face's inset", () => {
    // Archivo at 112% is the wordmark's and the lockups' face; at 75%, the
    // label's. Each rule that sets one sets its role's optical inset too.
    const unpulled = rules
      .filter(({ body }) => /font-stretch: (?:112|75)%/.test(body))
      .filter(
        ({ body }) =>
          !/text-indent: var\(--at-type-(?:wordmark|event-lockup|label)-inset\);/.test(
            body,
          ),
      )
      .map(({ selector }) => selector);
    expect(rules.length).toBeGreaterThan(100);
    expect(unpulled).toEqual([]);
  });
});

describe("a page in two columns", () => {
  test("starts both at the same rule line", () => {
    // One rule holds every column that starts a two-column page.
    const ruled = rules.filter(
      ({ selector, body }) =>
        selector.split(/,\s*/).includes(".evenings-head") &&
        body.includes(
          "border-top: var(--at-stroke-rule) solid var(--at-text)",
        ) &&
        body.includes("padding-top: var(--at-space-3)"),
    );
    expect(ruled).toHaveLength(1);
    const ruledSelector = ruled[0]?.selector ?? "";
    const columns = ruledSelector.split(/,\s*/);
    for (const column of [
      ".band > .pitch",
      ".lists",
      ".evenings-head",
      ".evenings-lists .list",
      ".about-head",
      ".about-part",
    ]) {
      expect(columns).toContain(column);
    }
  });
});

describe("a statement beside another column", () => {
  test("stands at the foot of its cell, every one by the one rule", () => {
    // The pitch is a flex column (its sentences stacked), so the end of
    // its main axis is the bottom of the cell it stretches to fill.
    const pitch = rules.find(({ selector }) => selector === ".pitch");
    expect(pitch?.body).toContain("display: flex");
    expect(pitch?.body).toContain("flex-direction: column");
    const anchored = rules.filter(({ body }) =>
      body.includes("justify-content: flex-end"),
    );
    expect(anchored.map(({ selector }) => selector)).toEqual([
      ".band > .pitch",
    ]);
    expect(anchored[0]?.body).toContain("align-self: stretch");
    // Its cell spans the row: nothing in the band aligns it otherwise.
    for (const { selector, body } of rules) {
      if (selector.split(/,\s*/).some((part) => /^\.band\b/.test(part))) {
        expect(body).not.toMatch(/align-(?:items|self|content): (?!stretch)/);
      }
    }
  });
});

describe("the home page's two sentences", () => {
  test("take their type from the lead role alone", () => {
    for (const selector of [".pitch", ".pitch-place"]) {
      const block = new RegExp(
        `(?:^|\\n)${selector.replace(".", "\\.")} \\{([^}]*)\\}`,
      ).exec(site)?.[1];
      expect(block).toBeDefined();
      expect(block).not.toMatch(
        /font-(?:size|weight|family|stretch)|line-height|letter-spacing/,
      );
    }
  });
});
