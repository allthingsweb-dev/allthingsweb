import {
  colors,
  type Dimension,
  dimensionGroups,
  dimensions,
  measures,
  type Mode,
  modes,
  themeRoles,
  type TokenFile,
  typeRoles,
} from "./tokens.ts";

/**
 * The tokens as CSS: the palette, fonts, type sizes and every length as
 * custom properties on :root, each breakpoint as a custom media query, each
 * mode's roles, one class per type role, and the cursor's blink. The site's
 * own rules take every length from here (web/tests/styles.test.ts).
 *
 * Paper is the default. Night applies under `prefers-color-scheme: dark`
 * unless the page asks for Paper with `data-theme="light"`, and wherever
 * `data-theme="dark"` is set: on <html> for a whole page, when the visitor
 * chose Night, or on any element for a part of one.
 */

/** The `data-theme` value of each mode. */
export const dataTheme = {
  paper: "light",
  night: "dark",
} as const satisfies Record<Mode, string>;

export function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function block(selector: string, declarations: ReadonlyArray<string>): string {
  return [
    `${selector} {`,
    ...declarations.map((line) => `  ${line}`),
    "}",
  ].join("\n");
}

/**
 * A length as CSS: its own size, or, for one that narrows with the screen,
 * the clamp or min that narrows it.
 */
export function length({ px, fluid }: Pick<Dimension, "px" | "fluid">): string {
  const largest = `${px}px`;
  if (fluid === undefined) return largest;
  if ("container" in fluid) return `min(${largest}, ${fluid.container}cqi)`;
  return fluid.min === undefined
    ? `min(${largest}, ${fluid.viewport}vw)`
    : `clamp(${fluid.min.value}px, ${fluid.viewport}vw, ${largest})`;
}

/**
 * The media condition that holds below a breakpoint `px` wide. Written as
 * `max-width` a fiftieth of a pixel short of it rather than as `width <`,
 * which Bun's minifier lowers to a `max-width` that can round up to the
 * breakpoint itself (1024 comes out as `max-width:1024px`).
 */
export const belowWidth = (px: number): string => `(max-width: ${px - 0.02}px)`;

/** The custom media query that holds below `breakpoint`, such as `--at-below-l`. */
export const belowBreakpoint = (breakpoint: string): string =>
  `--at-below-${kebab(breakpoint)}`;

/**
 * Expands the custom media queries a stylesheet defines with
 * `@custom-media --name (query);` wherever an `@media` uses them as
 * `(--name)`, and drops the definitions, as browsers don't read them yet.
 * A query naming one that isn't defined is an error, not a silent miss.
 */
export function expandCustomMedia(css: string): string {
  const queries = new Map<string, string>();
  const defined = css.replace(
    /@custom-media\s+(--[\w-]+)\s+([^;]+);\n?/g,
    (_, name: string, query: string) => {
      queries.set(name, query.trim());
      return "";
    },
  );
  return defined.replace(/@media([^{]*)\{/g, (_, prelude: string) => {
    const expanded = prelude.replace(/\((--[\w-]+)\)/g, (__, name: string) => {
      const query = queries.get(name);
      if (query === undefined) throw new Error(`No custom media ${name}`);
      return query;
    });
    return `@media${expanded}{`;
  });
}

function fontFamily(families: ReadonlyArray<string>): string {
  return families
    .map((family) => (family.includes(" ") ? `"${family}"` : family))
    .join(", ");
}

/** Each mode's background texture, as a URL; a mode without one has none. */
export type Textures = Partial<Record<Mode, string>>;

/**
 * A mode's roles, such as `--at-ground: var(--at-color-paper);`, and its
 * `--at-texture`, which pages layer over the ground.
 */
function roleDeclarations(
  file: TokenFile,
  mode: Mode,
  textures: Textures,
): ReadonlyArray<string> {
  const texture = textures[mode];
  return [
    `color-scheme: ${dataTheme[mode]};`,
    `--at-texture: ${texture === undefined ? "none" : `url("${texture}")`};`,
    ...themeRoles(file, mode).map(
      (role) =>
        `--at-${kebab(role.name)}: var(--at-color-${kebab(role.color.name)});`,
    ),
  ];
}

export function themeCss(file: TokenFile, textures: Textures = {}): string {
  const extension = file.$extensions["dev.allthings"];
  const root = block(":root", [
    ...colors(file).map(
      (color) => `--at-color-${kebab(color.name)}: ${color.hex.toLowerCase()};`,
    ),
    ...(["display", "mono"] as const).map(
      (name) => `--at-font-${name}: ${fontFamily(file.font[name].$value)};`,
    ),
    ...typeRoles(file).flatMap((role) => [
      `--at-type-${kebab(role.name)}-size: ${length({ px: role.size, fluid: role.fluid })};`,
      // Pulls a first line's ink back to the box's edge (text-indent): every face, at every
      // size, starts at one visual left edge (type-metrics.json).
      `--at-type-${kebab(role.name)}-inset: ${role.inset === 0 ? 0 : `-${role.inset}em`};`,
    ]),
    `--at-grid-columns: ${extension.gridColumns};`,
    `--at-ledger-label: ${extension.ledgerColumns};`,
    `--at-ledger-content: ${extension.gridColumns - extension.ledgerColumns};`,
    ...dimensionGroups
      .filter((group) => group !== "breakpoint")
      .flatMap((group) =>
        dimensions(file, group).map(
          (token) =>
            `--at-${kebab(group)}-${kebab(token.name)}: ${length(token)};`,
        ),
      ),
    ...measures(file).map(
      (measure) =>
        `--at-measure-${kebab(measure.name)}: ${measure.characters}ch;`,
    ),
    `--at-cursor-blink: ${file.motion.cursorBlink.$value.value}ms;`,
  ]);
  // Media queries can't read custom properties, so breakpoints are custom
  // media queries, which the build expands (expandCustomMedia).
  const breakpoints = dimensions(file, "breakpoint").map(
    (breakpoint) =>
      `@custom-media ${belowBreakpoint(breakpoint.name)} ${belowWidth(breakpoint.px)};`,
  );
  const [light, dark] = modes;
  const themes = [
    block(
      `:root,\n[data-theme="${dataTheme[light]}"]`,
      roleDeclarations(file, light, textures),
    ),
    block(
      `[data-theme="${dataTheme[dark]}"]`,
      roleDeclarations(file, dark, textures),
    ),
    [
      "@media (prefers-color-scheme: dark) {",
      block(
        `:root:not([data-theme="${dataTheme[light]}"])`,
        roleDeclarations(file, dark, textures),
      )
        .split("\n")
        .map((line) => `  ${line}`)
        .join("\n"),
      "}",
    ].join("\n"),
  ];
  const type = typeRoles(file).map((role) =>
    block(`.at-type-${kebab(role.name)}`, [
      `font-family: var(--at-font-${role.family});`,
      `font-size: var(--at-type-${kebab(role.name)}-size);`,
      `font-weight: ${role.weight};`,
      `line-height: ${role.lineHeight};`,
      `letter-spacing: ${role.letterSpacingEm}em;`,
      ...(role.width === undefined ? [] : [`font-stretch: ${role.width};`]),
      ...(role.uppercase ? ["text-transform: uppercase;"] : []),
      `text-indent: var(--at-type-${kebab(role.name)}-inset);`,
    ]),
  );
  // Swatches name a palette color without an inline style, which the
  // Content-Security-Policy forbids.
  const swatches = colors(file).map((color) =>
    block(`.at-swatch-${kebab(color.name)}`, [
      `--at-swatch: var(--at-color-${kebab(color.name)});`,
    ]),
  );
  const cursor = [
    "@keyframes at-cursor-blink {\n  50% {\n    opacity: 0;\n  }\n}",
    block(".at-cursor", [
      "animation: at-cursor-blink var(--at-cursor-blink) steps(1) infinite;",
    ]),
    "@media (prefers-reduced-motion: reduce) {\n  .at-cursor {\n    animation: none;\n  }\n}",
  ];
  return (
    [
      breakpoints.join("\n"),
      root,
      ...themes,
      ...type,
      ...swatches,
      ...cursor,
    ].join("\n\n") + "\n"
  );
}
