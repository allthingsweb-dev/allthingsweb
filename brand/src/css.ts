import {
  colors,
  type Mode,
  modes,
  themeRoles,
  type TokenFile,
  typeRoles,
} from "./tokens.ts";

/**
 * The tokens as CSS: the palette, fonts and layout as custom properties on
 * :root, each mode's roles, one class per type role, and the cursor's blink.
 *
 * Paper is the default. Night applies under `prefers-color-scheme: dark`
 * unless the page asks for Paper with `data-theme="light"`, and wherever
 * `data-theme="dark"` is set: on <html> for a whole page, such as an
 * evening's event page, or on any element for a part of one.
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

function fontFamily(families: ReadonlyArray<string>): string {
  return families
    .map((family) => (family.includes(" ") ? `"${family}"` : family))
    .join(", ");
}

/** A mode's roles, such as `--at-ground: var(--at-color-paper);`. */
function roleDeclarations(file: TokenFile, mode: Mode): ReadonlyArray<string> {
  return [
    `color-scheme: ${dataTheme[mode]};`,
    ...themeRoles(file, mode).map(
      (role) =>
        `--at-${kebab(role.name)}: var(--at-color-${kebab(role.color.name)});`,
    ),
  ];
}

export function themeCss(file: TokenFile): string {
  const extension = file.$extensions["dev.allthings"];
  const root = block(":root", [
    ...colors(file).map(
      (color) => `--at-color-${kebab(color.name)}: ${color.hex.toLowerCase()};`,
    ),
    ...(["display", "mono"] as const).map(
      (name) => `--at-font-${name}: ${fontFamily(file.font[name].$value)};`,
    ),
    `--at-grid-columns: ${extension.gridColumns};`,
    `--at-grid-gutter: ${file.layout.gutter.$value.value}px;`,
    `--at-page-margin: ${file.layout.margin.$value.value}px;`,
    `--at-cursor-blink: ${file.motion.cursorBlink.$value.value}ms;`,
  ]);
  const [light, dark] = modes;
  const themes = [
    block(
      `:root,\n[data-theme="${dataTheme[light]}"]`,
      roleDeclarations(file, light),
    ),
    block(`[data-theme="${dataTheme[dark]}"]`, roleDeclarations(file, dark)),
    [
      "@media (prefers-color-scheme: dark) {",
      block(
        `:root:not([data-theme="${dataTheme[light]}"])`,
        roleDeclarations(file, dark),
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
      `font-size: ${role.size}px;`,
      `font-weight: ${role.weight};`,
      `line-height: ${role.lineHeight};`,
      `letter-spacing: ${role.letterSpacingEm}em;`,
      ...(role.width === undefined ? [] : [`font-stretch: ${role.width};`]),
      ...(role.uppercase ? ["text-transform: uppercase;"] : []),
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
  return [root, ...themes, ...type, ...swatches, ...cursor].join("\n\n") + "\n";
}
