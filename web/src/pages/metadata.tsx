import { roleColor, tokens } from "allthings-brand/src/tokens.ts";
import { xHandle } from "../links.ts";
import { serializeJsonLd, type StructuredData } from "./structured-data.ts";
import type { Theme } from "./theme.ts";

/**
 * What every page says about itself in its head, for browsers, search
 * engines and link previews, from one description of the page.
 *
 * Every URL here is absolute and on the configured origin (`ORIGIN`, the
 * production site): a page served on a preview host still names its
 * production address as canonical. None of them is loaded: canonical and
 * alternate links and meta tags only point, so the Content-Security-Policy
 * has nothing to allow for them.
 *
 * Pages name no image for link previews (og:image) yet: the current site's
 * preview images carry the old name, and its routes that draw them go away
 * with it. Covers rendered from the brand's templates will fill it in, and
 * Twitter's card is the plain summary until then.
 */

/** Every page's title is a lockup: all things/<what the page is>. */
export type Title = `all things/${string}`;

/** all things/`slot`. */
export const lockup = (slot: string): Title => `all things/${slot}`;

/** The home page's title, with the slot left open: all things/_. */
export const homeTitle: Title = lockup("_");

/** The site's name, as link previews show it. */
export const siteName = "all things";

/** What the site is, in its own two sentences. */
export const siteDescription =
  "Evenings for people who build software. In the neighborhoods of San Francisco.";

/**
 * Where the RSS feed of every published event is, as on the current site,
 * so readers already subscribed keep receiving it (see seo/rss.ts).
 */
export const rssPath = "/rss";

/** A page, as its head describes it. */
export interface PageMeta {
  readonly title: Title;
  /** A sentence or two, for search results and link previews. */
  readonly description: string;
  /** Where the page is on the site; its canonical URL is this on the origin. */
  readonly path: `/${string}`;
  /** schema.org data about what the page is about, if any. */
  readonly structuredData?: ReadonlyArray<StructuredData>;
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
  // A title holds names as people wrote them, which the type can't vouch for.
  const unsafeTitle: string = meta.title;
  return (
    <>
      <title safe>{unsafeTitle}</title>
      <meta name="description" content={meta.description} />
      <link rel="canonical" href={canonical} />
      <link
        rel="alternate"
        type="application/rss+xml"
        href={`${origin}${rssPath}`}
        title={homeTitle}
      />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={siteName} />
      <meta property="og:locale" content="en_US" />
      <meta property="og:title" content={meta.title} />
      <meta property="og:description" content={meta.description} />
      <meta property="og:url" content={canonical} />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:site" content={`@${xHandle}`} />
      <ThemeColor theme={theme} />
      {(meta.structuredData ?? []).map((data) => (
        <JsonLd data={data} />
      ))}
    </>
  );
}
