import { mkdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  expandCustomMedia,
  type Textures,
  themeCss,
} from "allthings-brand/src/css.ts";
import {
  roleColor,
  type TokenFile,
  tokens,
} from "allthings-brand/src/tokens.ts";
import { Marked, Renderer, type Tokens } from "marked";
import { immutable } from "../src/cache.ts";

/**
 * Builds everything the Worker serves besides its own code, into web/dist:
 *
 * - `dist/public/` is the Worker's static assets directory. Cloudflare's
 *   asset layer answers for these files before the Worker runs. Everything
 *   under `/assets/` is named by a hash of its content, so `_headers` lets
 *   browsers and the edge keep it for a year without asking again.
 * - `dist/build.json` tells the Worker those hashed paths. The Worker
 *   bundles it.
 * - `dist/foundations.json` holds brand/foundations.md as HTML, for /brand
 *   alone: the Worker loads it with that page, never on a cold start.
 * - Files the current site serves under fixed names (its icons, /brand/*,
 *   /manifest.webmanifest) are written under those names too, so links to
 *   them keep working after the cutover (see fixedNames).
 *
 * The same sources always build the same files, byte for byte.
 */

const web = join(import.meta.dir, "..");
const root = join(web, "..");
const dist = join(web, "dist");
const publicDir = join(dist, "public");

/** Cache-Control for content-hashed files: a changed file gets a new name. */
export { immutable };

/** The first 16 hex digits of the SHA-256 of `bytes`. */
function contentHash(bytes: Uint8Array | string): string {
  return new Bun.CryptoHasher("sha256")
    .update(bytes)
    .digest("hex")
    .slice(0, 16);
}

/** Writes `bytes` as /assets/<name>.<hash>.<extension> and returns its path. */
async function writeAsset(
  name: string,
  extension: string,
  bytes: Uint8Array | string,
): Promise<string> {
  const path = `/assets/${name}.${contentHash(bytes)}.${extension}`;
  await Bun.write(join(publicDir, path), bytes);
  return path;
}

/** Google Fonts subsets, as fontsource names them. */
const subsets = ["latin", "latin-ext"] as const;
type Subset = (typeof subsets)[number];

interface Typeface {
  readonly family: string;
  /** The fontsource package and the stylesheet in it with the axes we use. */
  readonly package: string;
  readonly stylesheet: string;
  readonly file: (subset: Subset) => string;
  readonly display: "swap";
  readonly preload: ReadonlyArray<Subset>;
  /** The local faces that stand in for it, matched to its size, while it loads. */
  readonly fallback?: Fallback;
}

/**
 * A family of local faces, each scaled to a typeface's size at the widths
 * and weights it stands in for, named right after the typeface in its stack
 * (`siteTokens`). Until the typeface arrives, text is set in it, line for
 * line as the typeface will set it, so the swap moves nothing.
 */
interface Fallback {
  readonly family: string;
  /**
   * The typeface's ascent, descent and line gap, in ems: the fallback's are
   * overridden to these, so a line's height and baseline are the typeface's.
   */
  readonly ascent: number;
  readonly descent: number;
  readonly lineGap: number;
  readonly faces: ReadonlyArray<FallbackFace>;
}

interface FallbackFace {
  /** The width it stands in at, as the typeface's `font-stretch`. */
  readonly stretch: "75%" | "100%" | "112%";
  /** The weights it stands in at: Arial below 600, Arial Bold from 600. */
  readonly weight: "100 599" | "600 900";
  /**
   * How much larger than Arial it sets text (`size-adjust`): Archivo's
   * width over Arial's for the site's own text at this width and weight.
   */
  readonly sizeAdjust: number;
}

/**
 * Arial, or a face with its metrics where Arial isn't installed (Liberation
 * Sans on Linux, Arimo on ChromeOS), by full name and PostScript name. A
 * device with none of them (Android) falls back to its sans-serif, as
 * without a fallback family.
 */
const localSans: Record<FallbackFace["weight"], ReadonlyArray<string>> = {
  "100 599": ["Arial", "ArialMT", "Liberation Sans", "Arimo"],
  "600 900": [
    "Arial Bold",
    "Arial-BoldMT",
    "Liberation Sans Bold",
    "Arimo Bold",
  ],
};

/** A fraction as a CSS percentage, to a hundredth of a percent. */
const percent = (fraction: number): string =>
  `${Math.round(fraction * 10_000) / 100}%`;

/** The `@font-face` rules of `fallback`, one per face. */
const fallbackFaces = (fallback: Fallback): ReadonlyArray<string> =>
  fallback.faces.map((face) =>
    [
      "@font-face {",
      `font-family: "${fallback.family}";`,
      "font-style: normal;",
      `font-weight: ${face.weight};`,
      `font-stretch: ${face.stretch};`,
      `src: ${localSans[face.weight].map((name) => `local("${name}")`).join(", ")};`,
      `size-adjust: ${percent(face.sizeAdjust)};`,
      // Overrides are scaled by size-adjust, so each is divided by it.
      `ascent-override: ${percent(fallback.ascent / face.sizeAdjust)};`,
      `descent-override: ${percent(fallback.descent / face.sizeAdjust)};`,
      `line-gap-override: ${percent(fallback.lineGap / face.sizeAdjust)};`,
      "}",
    ].join("\n"),
  );

/**
 * The self-hosted typefaces (both SIL Open Font License 1.1). Fontsource
 * ships Google Fonts' subsets of each; the `latin` subset covers English and
 * Western European names, and `latin-ext` loads only for a character it
 * alone has (its `unicode-range`), such as ł or ő.
 *
 * - Archivo carries every width the brand uses (75%, 100%, 112%) on one
 *   variable font. It is preloaded, and `font-display: swap` because the
 *   brand is typographic: text must end up in Archivo. On a slow connection
 *   the preload lands after first paint (about 3 s in at 1.6 Mbps), and
 *   until then text is set in "Archivo Fallback": Arial, sized to Archivo's
 *   width at each width and weight the site uses, with Archivo's ascent and
 *   descent. Set in plain Arial, the lockup broke its lines elsewhere and
 *   the swap moved the page (a layout shift of about 0.025 on home).
 * - Geist Mono sets the meta: the dates, labels and navigation every page
 *   paints first. It is treated as Archivo is: its latin subset (23 KB) is
 *   preloaded, so it is fetched beside Archivo rather than after the
 *   stylesheet is read and is usually in before first paint, and
 *   `font-display: swap`, so the meta is never blank while it is on its
 *   way (`fallback` hid it for a moment, which showed at first paint). The
 *   system mono that stands in until then has the same advance and the
 *   meta's line height is its own, so the swap moves nothing.
 */
const typefaces: ReadonlyArray<Typeface> = [
  {
    family: "Archivo",
    package: "@fontsource-variable/archivo",
    stylesheet: "wdth.css",
    file: (subset) => `archivo-${subset}-wdth-normal`,
    display: "swap",
    preload: ["latin"],
    fallback: {
      family: "Archivo Fallback",
      // Archivo's hhea and OS/2 metrics (USE_TYPO_METRICS), per 1000 units.
      ascent: 0.878,
      descent: 0.21,
      lineGap: 0,
      // Measured in Chrome on the site's own text (home, /events, /about,
      // /people and evenings), with no letter-spacing: Archivo's width over
      // Arial's. At 112% and 800, the lockups and the wordmark are 1.156,
      // the event lockup 1.17 and figures 1.25; 1.16 favors the lockups.
      faces: [
        { stretch: "75%", weight: "100 599", sizeAdjust: 0.775 },
        { stretch: "75%", weight: "600 900", sizeAdjust: 0.785 },
        { stretch: "100%", weight: "100 599", sizeAdjust: 0.985 },
        { stretch: "100%", weight: "600 900", sizeAdjust: 0.98 },
        { stretch: "112%", weight: "100 599", sizeAdjust: 1.11 },
        { stretch: "112%", weight: "600 900", sizeAdjust: 1.16 },
      ],
    },
  },
  {
    family: "Geist Mono",
    package: "@fontsource-variable/geist-mono",
    stylesheet: "wght.css",
    file: (subset) => `geist-mono-${subset}-wght-normal`,
    display: "swap",
    preload: ["latin"],
  },
];

interface Font {
  readonly href: string;
  readonly preload: boolean;
}

/** One `@font-face` property, as fontsource declares it for `file`. */
function fontFaceProperty(css: string, file: string, property: string): string {
  const block = css
    .split("@font-face")
    .find((rule) => rule.includes(`/${file}.woff2`));
  const value =
    block === undefined
      ? undefined
      : new RegExp(`${property}: ([^;]+);`).exec(block)?.[1];
  if (value === undefined) throw new Error(`No ${property} for ${file}`);
  return value;
}

/**
 * Writes each typeface's subsets under hashed names, and returns their
 * `@font-face` rules, each typeface's fallback faces after its own, with
 * which files pages preload.
 */
async function buildFonts(): Promise<{
  css: string;
  fonts: ReadonlyArray<Font>;
}> {
  const faces: Array<string> = [];
  const fonts: Array<Font> = [];
  for (const typeface of typefaces) {
    const directory = dirname(
      Bun.resolveSync(`${typeface.package}/package.json`, web),
    );
    const css = await Bun.file(join(directory, typeface.stylesheet)).text();
    for (const subset of subsets) {
      const file = typeface.file(subset);
      const bytes = await Bun.file(
        join(directory, "files", `${file}.woff2`),
      ).bytes();
      const href = await writeAsset(file, "woff2", bytes);
      fonts.push({ href, preload: typeface.preload.includes(subset) });
      const stretch = css.includes("font-stretch")
        ? [`font-stretch: ${fontFaceProperty(css, file, "font-stretch")};`]
        : [];
      faces.push(
        [
          "@font-face {",
          `font-family: "${typeface.family}";`,
          "font-style: normal;",
          `font-display: ${typeface.display};`,
          `font-weight: ${fontFaceProperty(css, file, "font-weight")};`,
          ...stretch,
          `src: url(${href});`,
          `unicode-range: ${fontFaceProperty(css, file, "unicode-range")};`,
          "}",
        ].join("\n"),
      );
    }
    if (typeface.fallback !== undefined) {
      faces.push(...fallbackFaces(typeface.fallback));
    }
  }
  return { css: faces.join("\n"), fonts };
}

/**
 * The brand's tokens as the site sets them: each typeface with a fallback
 * family has it named right after it in its stack, ahead of the generic
 * family, so it stands in while the typeface loads.
 */
export function siteTokens(file: TokenFile): TokenFile {
  // A stack whose first family has a fallback, with it named second.
  const withFallback = (token: TokenFile["font"]["display"]) => {
    const [first, ...rest] = token.$value;
    const fallback = typefaces.find(
      (typeface) => typeface.family === first,
    )?.fallback;
    if (fallback === undefined) return token;
    const $value: TokenFile["font"]["display"]["$value"] = [
      first,
      fallback.family,
      ...rest,
    ];
    return { ...token, $value };
  };
  return {
    ...file,
    font: {
      ...file.font,
      display: withFallback(file.font.display),
      mono: withFallback(file.font.mono),
    },
  };
}

/**
 * The home lab's stylesheet (src/styles/lab.css), which only its pages load,
 * after the site's: its rules read the theme's custom properties from
 * there, and its breakpoints are the theme's custom media queries.
 */
async function buildLabStylesheet(): Promise<string> {
  const lab = await Bun.file(join(web, "src/styles/lab.css")).text();
  const breakpoints = themeCss(tokens)
    .split("\n")
    .filter((line) => line.startsWith("@custom-media "));
  const source = join(dist, "lab.css");
  await Bun.write(source, expandCustomMedia([...breakpoints, lab].join("\n")));
  const result = await Bun.build({ entrypoints: [source], minify: true });
  const [output] = result.outputs;
  if (!result.success || output === undefined) {
    throw new AggregateError(result.logs, "The lab's stylesheet didn't build");
  }
  await rm(source);
  return writeAsset("lab", "css", await output.text());
}

/**
 * The lab's script (src/client/lab.ts) and the engines it loads when a
 * page needs one, as browser modules under hashed names. Only lab pages
 * with an engine load it (pages/lab/variants.tsx).
 */
async function buildLabScript(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(web, "src/client/lab.ts")],
    target: "browser",
    format: "esm",
    splitting: true,
    minify: true,
    naming: {
      entry: "[name].[hash].[ext]",
      chunk: "lab-[name].[hash].[ext]",
    },
    publicPath: "/assets/",
    outdir: join(publicDir, "assets"),
  });
  const entry = result.outputs.find((output) => output.kind === "entry-point");
  if (!result.success || entry === undefined) {
    throw new AggregateError(result.logs, "The lab's script didn't build");
  }
  return `/assets/${basename(entry.path)}`;
}

/** Night's grain (brand/texture/grain.svg), under its hashed name. */
async function buildTextures(): Promise<Textures> {
  const grain = await Bun.file(join(root, "brand/texture/grain.svg")).bytes();
  return { night: await writeAsset("grain", "svg", grain) };
}

/** The site's one stylesheet: the faces, the theme from the tokens, then the site's own rules. */
async function buildStylesheet(fontFaces: string): Promise<string> {
  const site = await Bun.file(join(web, "src/styles/site.css")).text();
  const source = join(dist, "site.css");
  const theme = themeCss(siteTokens(tokens), await buildTextures());
  // The breakpoints are custom media queries, which browsers don't read yet.
  await Bun.write(
    source,
    expandCustomMedia([fontFaces, theme, site].join("\n")),
  );
  const result = await Bun.build({
    entrypoints: [source],
    minify: true,
    // Fonts are already in place under their hashed names.
    external: ["/assets/*"],
  });
  const [output] = result.outputs;
  if (!result.success || output === undefined) {
    throw new AggregateError(result.logs, "The stylesheet didn't build");
  }
  await rm(source);
  return writeAsset("site", "css", await output.text());
}

export interface Image {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

/**
 * The size an SVG asks for on its root element, in whole pixels: `<img>`
 * takes integer sizes, and they only reserve the mark's aspect ratio.
 */
function svgSize(svg: string): { width: number; height: number } {
  const rootTag = /<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
  const size = (name: string) =>
    Math.round(Number(new RegExp(` ${name}="([\\d.]+)"`).exec(rootTag)?.[1]));
  const [width, height] = [size("width"), size("height")];
  if (!(width > 0 && height > 0)) throw new Error("An SVG mark has no size");
  return { width, height };
}

/** A PNG's size, from its IHDR chunk. */
function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** A baseline JPEG's size, from its start-of-frame segment. */
function jpegSize(jpeg: Uint8Array): { width: number; height: number } {
  const view = new DataView(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength);
  let at = 2;
  while (at + 9 < jpeg.byteLength) {
    const marker = view.getUint16(at);
    if (marker === 0xffc0 || marker === 0xffc2) {
      return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
    }
    at += 2 + view.getUint16(at + 2);
  }
  throw new Error("A JPEG without a start-of-frame segment");
}

/** The marks brand/marks generates, by the name pages use for them. */
export interface Marks {
  readonly wordmark: Image;
  readonly wordmarkNight: Image;
  readonly mark: Image;
  readonly markNight: Image;
  readonly icon: Image;
  readonly favicon: Image;
  /** The blank avatar, for a person without a photo. */
  readonly avatar: Image;
  /** The same as a PNG, which a person's card draws (og/person-card.ts). */
  readonly avatarPng: Image;
  readonly appleTouchIcon: Image;
}

const generated = join(root, "app/public/brand");
/** What brand/marks/og.py generates: link-preview cards and their fonts. */
const og = join(root, "brand/og");

/** Copies one generated mark under its hashed name. */
async function mark(file: string, from = generated): Promise<Image> {
  const bytes = await Bun.file(join(from, file)).bytes();
  const [name = file, extension = ""] = file.split(".");
  const size =
    extension === "svg"
      ? svgSize(new TextDecoder().decode(bytes))
      : extension === "jpg"
        ? jpegSize(bytes)
        : pngSize(bytes);
  return { src: await writeAsset(name, extension, bytes), ...size };
}

/**
 * Files the current site serves under fixed names, which browsers, link
 * previews and other sites ask for by those names: its icons, now the
 * brand's (the names its pages linked; app/src/app/layout.tsx), and every
 * generated mark under /brand/, as app/public/brand serves them. They can't
 * be hashed, so the asset layer serves them as they are named.
 */
export const fixedNames: ReadonlyArray<readonly [string, string]> = [
  ["favicon.ico", "favicon.ico"],
  ["apple-touch-icon.png", "apple-touch-icon.png"],
  ["favicon-16.png", "icon-16.png"],
  ["favicon-32.png", "icon-32.png"],
  ["android-chrome-192.png", "icon-192.png"],
  ["android-chrome-512.png", "icon-512.png"],
];

/**
 * The web app manifest at /manifest.webmanifest, where the current site's
 * pages point browsers: the brand's name, its Paper ground, and the icons
 * above.
 */
export function webManifest(ground: string): string {
  return `${JSON.stringify(
    {
      name: "allthings",
      short_name: "allthings",
      description:
        "Evenings for people who build software. In the neighborhoods of San Francisco.",
      start_url: "/",
      display: "browser",
      background_color: ground,
      theme_color: ground,
      icons: [
        { src: "/android-chrome-192.png", sizes: "192x192", type: "image/png" },
        { src: "/android-chrome-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    null,
    2,
  )}\n`;
}

async function buildFixedNames(): Promise<void> {
  for (const [published, source] of fixedNames) {
    await Bun.write(
      join(publicDir, published),
      Bun.file(join(generated, source)),
    );
  }
  for await (const file of new Bun.Glob("*").scan({ cwd: generated })) {
    await Bun.write(
      join(publicDir, "brand", file),
      Bun.file(join(generated, file)),
    );
  }
  await Bun.write(
    join(publicDir, "manifest.webmanifest"),
    webManifest(roleColor(tokens, "paper", "ground").hex),
  );
}

async function buildMarks(): Promise<Marks> {
  await buildFixedNames();
  return {
    wordmark: await mark("wordmark.svg"),
    wordmarkNight: await mark("wordmark-night.svg"),
    mark: await mark("mark.svg"),
    markNight: await mark("mark-night.svg"),
    icon: await mark("icon.svg"),
    favicon: await mark("favicon.svg"),
    avatar: await mark("avatar.svg"),
    avatarPng: await mark("avatar.png"),
    appleTouchIcon: await mark("apple-touch-icon.png"),
  };
}

/** Link-preview cards brand/marks generates (og.py), 1200 x 630. */
export interface OgCards {
  readonly home: Image;
  readonly events: Image;
  readonly people: Image;
  /** The same as a JPEG: what a person's card falls back to. */
  readonly peopleJpeg: Image;
  readonly about: Image;
  readonly codeOfConduct: Image;
  readonly privacy: Image;
  readonly brand: Image;
  readonly notFound: Image;
  /** An event card's grounds, which the Worker sets its words on. */
  readonly eventNight: Image;
  readonly eventPaper: Image;
  /** A person's card's grounds, one for each part it can name. */
  readonly person: Readonly<Record<PersonPart, Image>>;
}

/** The parts a person's card names in its meta (og.py's PERSON_PARTS). */
export const personParts = [
  "organizer",
  "speaker",
  "co-host",
  "mc",
  "people",
] as const;

export type PersonPart = (typeof personParts)[number];

/** Where on its ground a person's card draws their photo, in pixels. */
export interface PhotoBox {
  readonly left: number;
  readonly top: number;
  readonly side: number;
}

/** The fonts the Worker has Images set a card's words in. */
export interface OgFonts {
  readonly lockup: string;
  readonly label: string;
  readonly lead: string;
  readonly meta: string;
}

/** A font's advances and ascent, in thousandths of the size (og.py). */
export interface OgFontMetrics {
  readonly ascent: number;
  readonly advances: Readonly<Record<string, number>>;
}

export type OgMetrics = Readonly<Record<keyof OgFonts, OgFontMetrics>>;

/** og.py's box for a person's photo, checked whole. */
function photoBox(value: unknown): PhotoBox {
  const box = value as Partial<Record<keyof PhotoBox, unknown>> | undefined;
  const sides = [box?.left, box?.top, box?.side];
  if (!sides.every((side) => Number.isInteger(side) && Number(side) >= 0)) {
    fail("og-person-photo");
  }
  return {
    left: Number(box?.left),
    top: Number(box?.top),
    side: Number(box?.side),
  };
}

async function buildOg(): Promise<{
  cards: OgCards;
  fonts: OgFonts;
  personPhoto: PhotoBox;
}> {
  const font = async (name: string) =>
    writeAsset(name, "ttf", await Bun.file(join(og, `${name}.ttf`)).bytes());
  // The Worker reads the metrics only when it draws a card, so they stay
  // out of the build manifest every request loads.
  const metrics = JSON.parse(
    await Bun.file(join(og, "og-metrics.json")).text(),
  ) as Record<string, OgFontMetrics | undefined>;
  const byRole: OgMetrics = {
    lockup: metrics["og-lockup"] ?? fail("og-lockup"),
    label: metrics["og-label"] ?? fail("og-label"),
    lead: metrics["og-lead"] ?? fail("og-lead"),
    meta: metrics["og-meta"] ?? fail("og-meta"),
  };
  await Bun.write(join(dist, "og-metrics.json"), `${JSON.stringify(byRole)}\n`);
  const person = Object.fromEntries(
    await Promise.all(
      personParts.map(
        async (part) =>
          [part, await mark(`og-person-${part}.png`, og)] as const,
      ),
    ),
  ) as Record<PersonPart, Image>;
  return {
    personPhoto: photoBox(metrics["og-person-photo"]),
    cards: {
      home: await mark("og-home.png", og),
      events: await mark("og-events.png", og),
      people: await mark("og-people.png", og),
      peopleJpeg: await mark("og-people.jpg", og),
      about: await mark("og-about.png", og),
      codeOfConduct: await mark("og-code-of-conduct.png", og),
      privacy: await mark("og-privacy.png", og),
      brand: await mark("og-brand.png", og),
      notFound: await mark("og-not-found.png", og),
      eventNight: await mark("og-event-night.png", og),
      eventPaper: await mark("og-event-paper.png", og),
      person,
    },
    fonts: {
      lockup: await font("og-lockup"),
      label: await font("og-label"),
      lead: await font("og-lead"),
      meta: await font("og-meta"),
    },
  };
}

function fail(name: string): never {
  throw new Error(`app/public/brand/og-metrics.json has no ${name}`);
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

/**
 * brand/foundations.md as HTML for the /brand page, where it sits under the
 * page's own title: every heading moves down a level. Tables scroll inside
 * a labelled region on narrow screens rather than widening the page.
 */
export function foundationsHtml(markdown: string): string {
  let heading = "";
  const marked = new Marked({
    gfm: true,
    walkTokens: (token) => {
      if (token.type === "heading") {
        (token as Tokens.Heading).depth += 1;
      }
    },
    renderer: {
      heading(this: Renderer, token: Tokens.Heading) {
        heading = token.text;
        return Renderer.prototype.heading.call(this, token);
      },
      table(this: Renderer, token: Tokens.Table) {
        const table = Renderer.prototype.table.call(this, token);
        return `<section class="scroll" aria-label="${escapeAttribute(heading)}" tabindex="0">${table}</section>\n`;
      },
    },
  });
  return marked.parse(markdown, { async: false });
}

/**
 * What the Worker's responses are made from: its code, core's, the brand's
 * tokens and foundations, and the locked dependencies. A change to any of
 * them is a new build.
 */
const buildSources = [
  "web/src/**/*",
  "core/src/**/*",
  // The hand-picked photos and faces core bundles into the pages.
  "core/backfill/*.json",
  "brand/src/**/*",
  "brand/all-things.tokens.json",
  "brand/foundations.md",
  "bun.lock",
] as const;

/**
 * The first 16 hex digits of the SHA-256 of every build source, by path
 * and content, in path order. The Worker's own cache keys pages by it, so a
 * deploy never serves a page built by another (edge-cache.ts).
 */
export async function buildHash(): Promise<string> {
  const paths = new Set<string>();
  for (const pattern of buildSources) {
    for await (const path of new Bun.Glob(pattern).scan({ cwd: root })) {
      paths.add(path);
    }
  }
  const hasher = new Bun.CryptoHasher("sha256");
  for (const path of [...paths].toSorted()) {
    hasher.update(`${path}\0`);
    hasher.update(await Bun.file(join(root, path)).bytes());
    hasher.update("\0");
  }
  return hasher.digest("hex").slice(0, 16);
}

/** What the Worker reads from dist/build.json. */
export interface BuildManifest {
  /** The build's content hash (see buildHash). */
  readonly build: string;
  readonly stylesheet: string;
  /** The home lab's own stylesheet, which only its pages load. */
  readonly labStylesheet: string;
  /** The lab's script, which only its pages with an engine load. */
  readonly labScript: string;
  readonly fonts: ReadonlyArray<Font>;
  readonly marks: Marks;
  readonly og: {
    readonly cards: OgCards;
    readonly fonts: OgFonts;
    readonly personPhoto: PhotoBox;
  };
}

/** What the Worker reads from dist/foundations.json: the foundations as HTML. */
export interface Foundations {
  readonly html: string;
}

const headers = `# Content-hashed files never change under their name.
/assets/*
  Cache-Control: ${immutable}
  X-Content-Type-Options: nosniff

# The web app manifest, by its registered type.
/manifest.webmanifest
  Content-Type: application/manifest+json
`;

export async function build(): Promise<BuildManifest> {
  await rm(dist, { recursive: true, force: true });
  await mkdir(publicDir, { recursive: true });
  const { css: fontFaces, fonts } = await buildFonts();
  const assets = {
    stylesheet: await buildStylesheet(fontFaces),
    labStylesheet: await buildLabStylesheet(),
    labScript: await buildLabScript(),
    fonts,
    marks: await buildMarks(),
    og: await buildOg(),
  };
  const foundations: Foundations = {
    html: foundationsHtml(
      await Bun.file(join(root, "brand/foundations.md")).text(),
    ),
  };
  const manifest: BuildManifest = {
    // Every hashed name pages link to is in the manifest, so a change to
    // what any of them is built from (a mark, a font, the stylesheet) is a
    // new build too, beside a change to the code (the foundations are among
    // the build sources).
    build: contentHash(`${await buildHash()}${JSON.stringify(assets)}`),
    ...assets,
  };
  await Bun.write(join(publicDir, "_headers"), headers);
  await Bun.write(
    join(dist, "build.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await Bun.write(
    join(dist, "foundations.json"),
    `${JSON.stringify(foundations)}\n`,
  );
  return manifest;
}

if (import.meta.main) {
  const { stylesheet } = await build();
  console.log(`Built web/dist (${stylesheet})`);
}
