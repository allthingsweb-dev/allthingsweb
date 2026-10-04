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
      [...site.matchAll(/var\((--at-[a-z-]+)\)/g)].map(([, name]) => name),
    );
    expect(used.size).toBeGreaterThan(5);
    for (const name of used) expect(theme).toContain(`${name}:`);
  });
});
