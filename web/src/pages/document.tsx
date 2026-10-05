import type { PropsWithChildren } from "@kitajs/html";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import { built } from "../assets.ts";
import {
  aboutPath,
  everyEvening,
  hosts,
  peoplePage,
  socials,
} from "../links.ts";
import { Metadata, type PageMeta } from "./metadata.tsx";
import { type ImageMode, Portrait } from "./picture.tsx";
import { type Choice, choices, type Theme } from "./theme.ts";

/**
 * The frame of every page: the document, the header with the wordmark, the
 * site's pages and the mode, and the footer that signs off with the hosts and the socials.
 * Pages are server-rendered HTML with no JavaScript; the cursor blinks in
 * CSS, and the mode is chosen with links (see theme.ts).
 */

/** The master wordmark, all things/_, linking home. */
export function Wordmark() {
  return (
    <a class="wordmark" href="/" aria-label="all things, home">
      all things<span class="slash">/</span>
      <span class="at-cursor" aria-hidden="true">
        _
      </span>
    </a>
  );
}

/** The sections the header names, which a page says it belongs to. */
export type Section = "events" | "people" | "about";

/** The site's sections, as the header names them, in its order. */
export const sections: ReadonlyArray<{
  readonly section: Section;
  readonly path: `/${string}`;
}> = [
  { section: "events", path: everyEvening },
  { section: "people", path: peoplePage },
  { section: "about", path: aboutPath },
];

/** The site's sections, the page's own marked with aria-current. */
function SiteNav({ section }: { readonly section: Section | undefined }) {
  return (
    <nav class="site-nav at-type-meta" aria-label="site">
      <ul>
        {sections.map((entry) => (
          <li>
            <a
              href={entry.path}
              aria-current={entry.section === section ? "page" : undefined}
            >
              {entry.section}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The mode's three icons, drawn to the same 16-unit grid in the text color:
 * the system's (half filled, either way), Paper (an open disc) and Night (a
 * filled one).
 */
function ModeIcon({ choice }: { readonly choice: Choice }) {
  return (
    <svg
      class="mode-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="8"
        cy="8"
        r="6.25"
        fill={choice === "dark" ? "currentColor" : "none"}
        stroke="currentColor"
        stroke-width="1.5"
      />
      {choice === "system" ? (
        <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" />
      ) : (
        ""
      )}
    </svg>
  );
}

/**
 * The mode, as one small control: a disclosure (<details>) whose summary is
 * the current mode's icon, opening on the three choices. Without
 * JavaScript, as the site is: <details> opens and closes natively, and
 * each choice is still a link to `?theme=` on this page, which the Worker
 * remembers and redirects from (theme.ts), so choosing reloads the page
 * closed. The summary's accessible name says what it is and what is
 * chosen; the current choice says so with aria-current. Crawlers are asked
 * not to follow the links. On a page with a mode of its own, such as an
 * event's, the system's choice is that mode, and says so.
 */
function ModeSwitch({
  theme,
  pageTheme,
}: {
  readonly theme: Theme | undefined;
  readonly pageTheme: Theme | undefined;
}) {
  const current = theme ?? "system";
  const nameOf = (choice: Choice, name: string) =>
    choice === "system" && pageTheme !== undefined ? "event" : name;
  const currentName = nameOf(
    current,
    choices.find(({ choice }) => choice === current)?.label ?? current,
  );
  return (
    <details class="mode">
      <summary aria-label={`mode: ${currentName}`}>
        <ModeIcon choice={current} />
      </summary>
      <ul class="at-type-meta">
        {choices.map(({ choice, label }) => (
          <li>
            <a
              href={`?theme=${choice}`}
              rel="nofollow"
              aria-current={choice === current ? "true" : undefined}
            >
              <ModeIcon choice={choice} />
              <span safe>{nameOf(choice, label)}</span>
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The hosts sign off with their portraits from their speaker profiles, or
 * the brand's blank avatar where there is none. The originals are large
 * (684 to 2160 px, megabytes) and shown at 36, so with variants they come
 * at 36 and 72 pixels (see picture.tsx). Who they are, and what all things
 * is, is on the about page their names link to.
 */
function Footer({
  portraits,
  images,
}: {
  readonly portraits: PortraitsById;
  readonly images: ImageMode;
}) {
  return (
    <footer class="site-footer">
      <div class="hosts">
        <span class="portraits">
          {hosts.map((host) => (
            <Portrait
              photo={portraits.get(host.profileId)}
              mode={images}
              blank={built.marks.avatar.src}
            />
          ))}
        </span>
        <p>
          <a href={aboutPath} safe>
            {`hosted by ${hosts[0].name} & ${hosts[1].name}`}
          </a>
        </p>
      </div>
      <nav aria-label="all things elsewhere">
        <ul class="socials at-type-meta">
          {socials.map((social) => (
            <li>
              <a href={social.href} safe>
                {social.name}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}

export interface DocumentProps {
  /** What the head says about the page (see metadata.tsx). */
  readonly meta: PageMeta;
  /** The production origin, which the page's canonical URL is made from. */
  readonly origin: string;
  /** The mode the visitor fixed, if any (see theme.ts). */
  readonly theme: Theme | undefined;
  /**
   * The page's own mode, when the visitor fixed none: an event's (see
   * core's mode.ts). Without one, the page follows the system.
   */
  readonly pageTheme?: Theme | undefined;
  /** The hosts' portraits, by profile id, for the footer. */
  readonly portraits: PortraitsById;
  /** How photos are shown (see picture.tsx). */
  readonly images: ImageMode;
  /**
   * The header section the page belongs to, marked as current: an evening's
   * page belongs to the evenings. None for pages outside them, such as
   * /brand.
   */
  readonly section?: Section | undefined;
}

/** A whole HTML document around `children`, the page's <main>. */
export function Document({
  meta,
  origin,
  theme,
  pageTheme,
  portraits,
  images,
  section,
  children,
}: PropsWithChildren<DocumentProps>): string {
  // What the page renders in: the visitor's choice, else the page's own.
  const shown = theme ?? pageTheme;
  const fonts = built.fonts.filter((font) => font.preload);
  const page = (
    <html lang="en" data-theme={shown}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Metadata meta={meta} origin={origin} theme={shown} />
        {fonts.map((font) => (
          <link
            rel="preload"
            href={font.href}
            as="font"
            type="font/woff2"
            crossorigin=""
          />
        ))}
        <link rel="stylesheet" href={built.stylesheet} />
        <link rel="icon" href={built.marks.favicon.src} type="image/svg+xml" />
        <link rel="apple-touch-icon" href={built.marks.appleTouchIcon.src} />
        <link rel="manifest" href="/manifest.webmanifest" />
      </head>
      <body>
        <div class="page">
          <header class="site-header">
            <Wordmark />
            <div class="site-tools">
              <SiteNav section={section} />
              <ModeSwitch theme={theme} pageTheme={pageTheme} />
            </div>
          </header>
          <main>{children}</main>
          <Footer portraits={portraits} images={images} />
        </div>
      </body>
    </html>
  );
  // Components here are synchronous, so the page is a string, never a promise.
  if (typeof page !== "string")
    throw new Error("A page rendered asynchronously");
  return `<!doctype html>${page}`;
}
