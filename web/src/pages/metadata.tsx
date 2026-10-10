import { roleColor, tokens } from "allthings-brand/src/tokens.ts";
import { xHandle } from "../links.ts";
import { serializeJsonLd, type StructuredData } from "./structured-data.ts";
import type { Theme } from "./theme.ts";

/**
 * What every page says about itself in its head, for browsers, search
 * engines and link previews, from one description of the page.
 *
 * The page's own address is absolute and on the configured origin
 * (`ORIGIN`, the production site): a page served on a preview host still
 * names its production address as canonical and in link previews. The
 * feed is linked root-relative, like every link within the site (see
 * links.ts), so each stage links to its own. None of them is loaded:
 * canonical and alternate links and meta tags only point, so the
 * Content-Security-Policy has nothing to allow for them.
 *
 * Every page names its link-preview card (og:image, and X's large card),
 * 1200 x 630 and absolute on the origin like the page's own address: the
 * brand's cards for pages that don't change with data (brand/marks/og.py),
 * and each event's own, drawn by the Worker (og/route.ts).
 */

/**
 * Every page's title carries the lockup: allthings/<what the page is>,
 * or, for a page that gathers others, its name before the open slot.
 */
export type Title = `allthings/${string}` | `${string} · allthings/_`;

/** allthings/`slot`. */
export const lockup = (slot: string): Title => `allthings/${slot}`;

/** `name` · allthings/_, for a page that gathers others, such as every evening. */
export const gatheringTitle = (name: string): Title => `${name} · allthings/_`;

/** The home page's title, with the slot left open: allthings/_. */
export const homeTitle: Title = lockup("_");

/** The site's name, as link previews show it. */
export const siteName = "allthings";

/** What the site is, in its own two sentences. */
export const siteDescription =
  "Evenings for people who build software. In the neighborhoods of San Francisco.";

/**
 * Where the RSS feed of every published event is, as on the current site,
 * so readers already subscribed keep receiving it (see seo/rss.ts).
 */
export const rssPath = "/rss";

/** A link-preview card: where it is on the site, its size, and what it says. */
export interface OgImage {
  /** Root-relative, as `/assets/og-home.<hash>.png`; made absolute on the origin. */
  readonly src: `/${string}`;
  readonly width: number;
  readonly height: number;
  /** What the card shows, for people who can't see it. */
  readonly alt: string;
}

/** A page, as its head describes it. */
export interface PageMeta {
  readonly title: Title;
  /** A sentence or two, for search results and link previews. */
  readonly description: string;
  /** Where the page is on the site; its canonical URL is this on the origin. */
  readonly path: `/${string}`;
  /** Its link-preview card. */
  readonly image: OgImage;
  /** schema.org data about what the page is about, if any. */
  readonly structuredData?: ReadonlyArray<StructuredData>;
  /**
   * Kept out of search engines, and its links not followed: the home lab's
   * pages (pages/lab/), which are experiments, not the site.
   */
  readonly noindex?: true;
}

/** Each mode's ground, for the browser's own chrome. */
const themeColor = {
  light: roleColor(tokens, "paper", "ground").hex,
  dark: roleColor(tokens, "night", "ground").hex,
} as const;

function ThemeColor({ theme }: { readonly theme: Theme | undefined }) {
  if (theme !== undefined) {
    return (
      <>
        <meta name="color-scheme" content={theme} />
        <meta name="theme-color" content={themeColor[theme]} />
      </>
    );
  }
  return (
    <>
      <meta name="color-scheme" content="light dark" />
      <meta
        name="theme-color"
        content={themeColor.light}
        media="(prefers-color-scheme: light)"
      />
      <meta
        name="theme-color"
        content={themeColor.dark}
        media="(prefers-color-scheme: dark)"
      />
    </>
  );
}

/** JSON-LD, serialized so that nothing in it can end the element. */
function JsonLd({ data }: { readonly data: StructuredData }) {
  const safeJson = serializeJsonLd(data);
  return <script type="application/ld+json">{safeJson}</script>;
}

export interface MetadataProps {
  readonly meta: PageMeta;
  /** The production origin, which canonical URLs are made from. */
  readonly origin: string;
  /** The mode the visitor fixed, if any (see theme.ts). */
  readonly theme: Theme | undefined;
}

/**
 * The page's title, description, canonical URL, feed, link preview
 * (Open Graph, which X reads too), browser colors and structured data.
 */
export function Metadata({ meta, origin, theme }: MetadataProps) {
  const canonical = `${origin}${meta.path}`;
  const image = `${origin}${meta.image.src}`;
  // A title holds names as people wrote them, which the type can't vouch for.
  const unsafeTitle: string = meta.title;
  return (
    <>
      <title safe>{unsafeTitle}</title>
      <meta name="description" content={meta.description} />
      {meta.noindex === true ? (
        <meta name="robots" content="noindex, nofollow" />
      ) : (
        ""
      )}
      <link rel="canonical" href={canonical} />
      <link
        rel="alternate"
        type="application/rss+xml"
        href={rssPath}
        title={homeTitle}
      />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={siteName} />
      <meta property="og:locale" content="en_US" />
      <meta property="og:title" content={meta.title} />
      <meta property="og:description" content={meta.description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={image} />
      <meta property="og:image:type" content="image/png" />
      <meta property="og:image:width" content={String(meta.image.width)} />
      <meta property="og:image:height" content={String(meta.image.height)} />
      <meta property="og:image:alt" content={meta.image.alt} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content={`@${xHandle}`} />
      <meta name="twitter:image" content={image} />
      <meta name="twitter:image:alt" content={meta.image.alt} />
      <ThemeColor theme={theme} />
      {(meta.structuredData ?? []).map((data) => (
        <JsonLd data={data} />
      ))}
    </>
  );
}
