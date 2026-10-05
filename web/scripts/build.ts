import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Textures, themeCss } from "allthings-brand/src/css.ts";
import { tokens } from "allthings-brand/src/tokens.ts";
import { Marked, Renderer, type Tokens } from "marked";

/**
 * Builds everything the Worker serves besides its own code, into web/dist:
 *
 * - `dist/public/` is the Worker's static assets directory. Cloudflare's
 *   asset layer answers for these files before the Worker runs. Everything
 *   under `/assets/` is named by a hash of its content, so `_headers` lets
 *   browsers and the edge keep it for a year without asking again.
 * - `dist/build.json` tells the Worker those hashed paths and holds
 *   brand/foundations.md as HTML. The Worker bundles it.
 *
 * The same sources always build the same files, byte for byte.
 */

const web = join(import.meta.dir, "..");
const root = join(web, "..");
const dist = join(web, "dist");
const publicDir = join(dist, "public");

/** Cache-Control for content-hashed files: a changed file gets a new name. */
export const immutable = "public, max-age=31536000, immutable";

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
  readonly display: "swap" | "fallback";
  readonly preload: ReadonlyArray<Subset>;
}

/**
 * The self-hosted typefaces (both SIL Open Font License 1.1). Fontsource
 * ships Google Fonts' subsets of each; the `latin` subset covers English and
 * Western European names, and `latin-ext` loads only for a character it
 * alone has (its `unicode-range`), such as ł or ő.
 *
 * - Archivo carries every width the brand uses (75%, 100%, 112%) on one
 *   variable font. It is preloaded, and `font-display: swap` because the
 *   brand is typographic: text must end up in Archivo, and the preload
 *   usually lands before first paint, so the swap is rarely seen.
 * - Geist Mono sets only small meta. It isn't preloaded, and
 *   `font-display: fallback` keeps the system mono if it is slow to arrive,
 *   rather than reflowing meta late.
 */
const typefaces: ReadonlyArray<Typeface> = [
  {
    family: "Archivo",
    package: "@fontsource-variable/archivo",
    stylesheet: "wdth.css",
    file: (subset) => `archivo-${subset}-wdth-normal`,
    display: "swap",
    preload: ["latin"],
  },
  {
    family: "Geist Mono",
    package: "@fontsource-variable/geist-mono",
    stylesheet: "wght.css",
    file: (subset) => `geist-mono-${subset}-wght-normal`,
    display: "fallback",
    preload: [],
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
  }
  return { css: faces.join("\n"), fonts };
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
  const theme = themeCss(tokens, await buildTextures());
  await Bun.write(source, [fontFaces, theme, site].join("\n"));
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
  readonly appleTouchIcon: Image;
}

const generated = join(root, "app/public/brand");

/** Copies one generated mark under its hashed name. */
async function mark(file: string): Promise<Image> {
  const bytes = await Bun.file(join(generated, file)).bytes();
  const [name = file, extension = ""] = file.split(".");
  const size =
    extension === "svg"
      ? svgSize(new TextDecoder().decode(bytes))
      : pngSize(bytes);
  return { src: await writeAsset(name, extension, bytes), ...size };
}

async function buildMarks(): Promise<Marks> {
  // Browsers ask for /favicon.ico by that name, so it can't be hashed.
  await Bun.write(
    join(publicDir, "favicon.ico"),
    Bun.file(join(generated, "favicon.ico")),
  );
  return {
    wordmark: await mark("wordmark.svg"),
    wordmarkNight: await mark("wordmark-night.svg"),
    mark: await mark("mark.svg"),
    markNight: await mark("mark-night.svg"),
    icon: await mark("icon.svg"),
    favicon: await mark("favicon.svg"),
    avatar: await mark("avatar.svg"),
    appleTouchIcon: await mark("apple-touch-icon.png"),
  };
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

/** What the Worker reads from dist/build.json. */
export interface BuildManifest {
  readonly stylesheet: string;
  readonly fonts: ReadonlyArray<Font>;
  readonly marks: Marks;
  readonly foundations: string;
}

const headers = `# Content-hashed files never change under their name.
/assets/*
  Cache-Control: ${immutable}
  X-Content-Type-Options: nosniff
`;

export async function build(): Promise<BuildManifest> {
  await rm(dist, { recursive: true, force: true });
  await mkdir(publicDir, { recursive: true });
  const { css: fontFaces, fonts } = await buildFonts();
  const manifest: BuildManifest = {
    stylesheet: await buildStylesheet(fontFaces),
    fonts,
    marks: await buildMarks(),
    foundations: foundationsHtml(
      await Bun.file(join(root, "brand/foundations.md")).text(),
    ),
  };
  await Bun.write(join(publicDir, "_headers"), headers);
  await Bun.write(
    join(dist, "build.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

if (import.meta.main) {
  const { stylesheet } = await build();
  console.log(`Built web/dist (${stylesheet})`);
}
