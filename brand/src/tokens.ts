import { Schema } from "effect";
import source from "../all-things.tokens.json" with { type: "json" };

/**
 * The all things/_ design tokens: all-things.tokens.json, in the W3C Design
 * Tokens Community Group format, validated. Everything that draws the brand
 * (the site's CSS, the marks, covers) reads them from here.
 */

const Description = Schema.String.check(Schema.isNonEmpty());

/** A `{group.name}` reference to a token in `group`; names are checked below. */
const Reference = (group: "color" | "font") =>
  Schema.String.check(
    Schema.isPattern(new RegExp(`^\\{${group}\\.[A-Za-z]+\\}$`), {
      expected: `a {${group}.name} reference`,
    }),
  );

/**
 * A DTCG group: `$type` names the type of its tokens and every other key is
 * a token. Only `$type` may hold the type's name.
 */
const Group = <const Type extends string, Token extends Schema.Top>(
  type: Type,
  token: Token,
) =>
  Schema.Record(
    Schema.String,
    Schema.Union([Schema.Literal(type), token]),
  ).check(
    Schema.makeFilter((entries) => {
      if (entries["$type"] !== type) return `expected $type "${type}"`;
      const misplaced = Object.entries(entries).find(
        ([name, value]) => (name === "$type") !== (value === type),
      );
      return misplaced === undefined || `expected a token at ${misplaced[0]}`;
    }),
  );

const Channel = Schema.Finite.check(
  Schema.isBetween({ minimum: 0, maximum: 1 }),
);

const ColorToken = Schema.Struct({
  $value: Schema.Struct({
    colorSpace: Schema.Literal("srgb"),
    components: Schema.Tuple([Channel, Channel, Channel]),
  }),
  $description: Description,
});

const Px = Schema.Struct({ value: Schema.Finite, unit: Schema.Literal("px") });

const Positive = Schema.Finite.check(Schema.isGreaterThan(0));

/**
 * How a length narrows on a smaller screen, below the token's own value, its
 * largest: with the viewport, a share of its width (`vw`), never below `min`
 * when one is given; or with its container, a share of the container's
 * inline size (`cqi`).
 */
const Fluid = Schema.Union([
  Schema.Struct({ min: Schema.optionalKey(Px), viewport: Positive }),
  Schema.Struct({ container: Positive }),
]);

export type Fluid = typeof Fluid.Type;

/** A length; one that narrows with the screen says how in its extension. */
const DimensionToken = Schema.Struct({
  $value: Px,
  $description: Description,
  $extensions: Schema.optionalKey(
    Schema.Struct({ "dev.allthings": Schema.Struct({ fluid: Fluid }) }),
  ),
});

const NumberToken = Schema.Struct({
  $value: Positive,
  $description: Description,
});

const TypeToken = Schema.Struct({
  $value: Schema.Struct({
    fontFamily: Reference("font"),
    fontSize: Px,
    fontWeight: Schema.Int.check(
      Schema.isBetween({ minimum: 1, maximum: 1000 }),
    ),
    lineHeight: Schema.Finite.check(Schema.isGreaterThan(0)),
    letterSpacing: Px,
  }),
  $description: Description,
  $extensions: Schema.Struct({
    "dev.allthings": Schema.Struct({
      width: Schema.optionalKey(
        Schema.String.check(Schema.isPattern(/^\d+%$/)),
      ),
      letterSpacingEm: Schema.Finite,
      textTransform: Schema.optionalKey(Schema.Literal("uppercase")),
      fluid: Schema.optionalKey(Fluid),
    }),
  }),
});

const FontToken = Schema.Struct({
  $value: Schema.NonEmptyArray(Schema.String),
  $description: Description,
});

/** A color role in a mode: an alias of a palette color. */
const RoleToken = Schema.Struct({
  $value: Reference("color"),
  $description: Description,
});

const ContrastPair = Schema.Struct({
  text: Reference("color"),
  background: Reference("color"),
  minLc: Schema.Finite.check(Schema.isGreaterThan(0)),
  use: Description,
});

const TokenFileShape = Schema.Struct({
  $description: Description,
  color: Group("color", ColorToken),
  font: Schema.Struct({
    $type: Schema.Literal("fontFamily"),
    display: FontToken,
    mono: FontToken,
  }),
  type: Group("typography", TypeToken),
  layout: Group("dimension", DimensionToken),
  space: Group("dimension", DimensionToken),
  stroke: Group("dimension", DimensionToken),
  size: Group("dimension", DimensionToken),
  fontSize: Group("dimension", DimensionToken),
  measure: Group("number", NumberToken),
  breakpoint: Group("dimension", DimensionToken),
  motion: Schema.Struct({
    cursorBlink: Schema.Struct({
      $type: Schema.Literal("duration"),
      $value: Schema.Struct({
        value: Schema.Finite.check(Schema.isGreaterThan(0)),
        unit: Schema.Literal("ms"),
      }),
      $description: Description,
    }),
  }),
  theme: Schema.Struct({
    $description: Description,
    paper: Group("color", RoleToken),
    night: Group("color", RoleToken),
  }),
  $extensions: Schema.Struct({
    "dev.allthings": Schema.Struct({
      gridColumns: Schema.Int.check(Schema.isGreaterThan(0)),
      /** Of the grid's columns, those a ledger's labels take. */
      ledgerColumns: Schema.Int.check(Schema.isGreaterThan(0)),
      contrast: Schema.NonEmptyArray(ContrastPair),
    }),
  }),
});

type TokenFileShape = typeof TokenFileShape.Type;

/** The name a `{group.name}` reference points at. */
export function referencedName(reference: string): string {
  return reference.slice(1, -1).split(".")[1] ?? "";
}

/** The tokens of a DTCG group, by name, without its `$type`. */
function tokensOf<Token>(
  group: Readonly<Record<string, string | Token>>,
): Array<[string, Token]> {
  return Object.entries(group).filter(
    (entry): entry is [string, Token] => entry[0] !== "$type",
  );
}

/** Every reference names a token that exists, and both modes define the same roles. */
function referenceIssues(file: TokenFileShape): ReadonlyArray<string> {
  const colorNames = new Set(tokensOf(file.color).map(([name]) => name));
  const fonts = new Set(["display", "mono"]);
  const issues: Array<string> = [];
  for (const [role, token] of tokensOf(file.type)) {
    if (!fonts.has(referencedName(token.$value.fontFamily))) {
      issues.push(`type.${role}: unknown font ${token.$value.fontFamily}`);
    }
  }
  for (const mode of ["paper", "night"] as const) {
    for (const [role, token] of tokensOf(file.theme[mode])) {
      if (!colorNames.has(referencedName(token.$value))) {
        issues.push(`theme.${mode}.${role}: unknown color ${token.$value}`);
      }
    }
  }
  const roles = (mode: "paper" | "night") =>
    tokensOf(file.theme[mode])
      .map(([role]) => role)
      .join(", ");
  if (roles("paper") !== roles("night")) {
    issues.push(
      `theme: paper has ${roles("paper")} but night has ${roles("night")}`,
    );
  }
  const { gridColumns, ledgerColumns } = file.$extensions["dev.allthings"];
  if (ledgerColumns >= gridColumns) {
    issues.push(
      `ledgerColumns: ${ledgerColumns} leaves none of the ${gridColumns} columns to the content`,
    );
  }
  file.$extensions["dev.allthings"].contrast.forEach((pair, index) => {
    for (const side of ["text", "background"] as const) {
      if (!colorNames.has(referencedName(pair[side]))) {
        issues.push(`contrast[${index}].${side}: unknown color ${pair[side]}`);
      }
    }
  });
  return issues;
}

/** The token file's schema, references included. */
export const TokenFile = TokenFileShape.check(
  Schema.makeFilter((file) => {
    const issues = referenceIssues(file);
    return issues.length === 0 || issues.join("; ");
  }),
);

export type TokenFile = typeof TokenFile.Type;

/** The brand's tokens, validated when first imported. */
export const tokens: TokenFile = Schema.decodeUnknownSync(TokenFile)(source);

/** The two modes: Paper is light, Night is dark. */
export const modes = ["paper", "night"] as const;
export type Mode = (typeof modes)[number];

export interface Color {
  /** The token's name, such as `bridgeDeep`. */
  readonly name: string;
  /** Uppercase `#RRGGBB`. */
  readonly hex: string;
  readonly description: string;
}

function toHex(components: readonly [number, number, number]): string {
  const hex = components
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
  return `#${hex.toUpperCase()}`;
}

/** The palette, in the token file's order. */
export function colors(file: TokenFile): ReadonlyArray<Color> {
  return tokensOf(file.color).map(([name, token]) => ({
    name,
    hex: toHex(token.$value.components),
    description: token.$description,
  }));
}

/** The palette color a `{color.name}` reference points at. */
export function resolveColor(file: TokenFile, reference: string): Color {
  const name = referencedName(reference);
  const color = colors(file).find((candidate) => candidate.name === name);
  // TokenFile's filter rejects unknown references, so decoded files have none.
  if (color === undefined) throw new Error(`Unknown color ${reference}`);
  return color;
}

export interface Role {
  /** The role's name, such as `ground` or `buttonText`. */
  readonly name: string;
  readonly color: Color;
  readonly description: string;
}

/** What each color does in `mode`. */
export function themeRoles(file: TokenFile, mode: Mode): ReadonlyArray<Role> {
  return tokensOf(file.theme[mode]).map(([name, token]) => ({
    name,
    color: resolveColor(file, token.$value),
    description: token.$description,
  }));
}

/** The color of one of `mode`'s roles, such as its `ground`. */
export function roleColor(file: TokenFile, mode: Mode, role: string): Color {
  const found = themeRoles(file, mode).find(
    (candidate) => candidate.name === role,
  );
  if (found === undefined) throw new Error(`The ${mode} mode has no ${role}`);
  return found.color;
}

export interface TypeRole {
  /** The role's name, such as `eventLockup`. */
  readonly name: string;
  readonly description: string;
  readonly family: "display" | "mono";
  readonly size: number;
  readonly weight: number;
  readonly lineHeight: number;
  readonly letterSpacingEm: number;
  /** `font-stretch`, when the role sets one. */
  readonly width: string | undefined;
  readonly uppercase: boolean;
  /** How the size narrows on smaller screens, when it does. */
  readonly fluid: Fluid | undefined;
}

/** The type scale, in the token file's order. */
export function typeRoles(file: TokenFile): ReadonlyArray<TypeRole> {
  return tokensOf(file.type).map(([name, token]) => {
    const extension = token.$extensions["dev.allthings"];
    return {
      name,
      description: token.$description,
      family:
        referencedName(token.$value.fontFamily) === "mono" ? "mono" : "display",
      size: token.$value.fontSize.value,
      weight: token.$value.fontWeight,
      lineHeight: token.$value.lineHeight,
      letterSpacingEm: extension.letterSpacingEm,
      width: extension.width,
      uppercase: extension.textTransform === "uppercase",
      fluid: extension.fluid,
    };
  });
}

export interface ContrastRequirement {
  readonly text: Color;
  readonly background: Color;
  readonly minLc: number;
  readonly use: string;
}

/** The pairings the brand uses for text, each with its minimum APCA Lc. */
export function contrastRequirements(
  file: TokenFile,
): ReadonlyArray<ContrastRequirement> {
  return file.$extensions["dev.allthings"].contrast.map((pair) => ({
    text: resolveColor(file, pair.text),
    background: resolveColor(file, pair.background),
    minLc: pair.minLc,
    use: pair.use,
  }));
}

/** The groups of lengths: the page's frame, spacing, strokes, boxes, text sizes and breakpoints. */
export const dimensionGroups = [
  "layout",
  "space",
  "stroke",
  "size",
  "fontSize",
  "breakpoint",
] as const;
export type DimensionGroup = (typeof dimensionGroups)[number];

export interface Dimension {
  /** The token's name in its group, such as `margin` or `portraitXl`. */
  readonly name: string;
  /** Its largest size, in CSS pixels. */
  readonly px: number;
  /** How it narrows on smaller screens, when it does. */
  readonly fluid: Fluid | undefined;
  readonly description: string;
}

/** The lengths of `group`, in the token file's order. */
export function dimensions(
  file: TokenFile,
  group: DimensionGroup,
): ReadonlyArray<Dimension> {
  return tokensOf(file[group]).map(([name, token]) => ({
    name,
    px: token.$value.value,
    fluid: token.$extensions?.["dev.allthings"].fluid,
    description: token.$description,
  }));
}

/** One length of `group` by name; the code that asks for it relies on it. */
export function dimension(
  file: TokenFile,
  group: DimensionGroup,
  name: string,
): Dimension {
  const found = dimensions(file, group).find(
    (candidate) => candidate.name === name,
  );
  if (found === undefined) throw new Error(`No ${group}.${name} token`);
  return found;
}

export interface Measure {
  /** The token's name, such as `prose`. */
  readonly name: string;
  /** Characters to a line: `ch`. */
  readonly characters: number;
  readonly description: string;
}

/** The reading measures, in the token file's order. */
export function measures(file: TokenFile): ReadonlyArray<Measure> {
  return tokensOf(file.measure).map(([name, token]) => ({
    name,
    characters: token.$value,
    description: token.$description,
  }));
}
