import type { PropsWithChildren } from "@kitajs/html";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import { built } from "../assets.ts";
import {
  aboutPath,
  everyEvening,
  homePath,
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
 * CSS, and the mode is chosen with links (see theme.ts). The one exception
 * is a lab page with an engine (`script`), which loads the site's own
 * module and is whole without it.
 */

/** The master wordmark, allthings/_, linking home. */
export function Wordmark() {
  return (
    <a class="wordmark" href="/" aria-label="allthings, home">
      allthings<span class="slash">/</span>
      <span class="at-cursor" aria-hidden="true">
        _
      </span>
    </a>
  );
}

/** The sections the header names, which a page says it belongs to. */
export type Section = "home" | "events" | "people" | "about";

/** The site's sections, as the header names them, in its order. */
export const sections: ReadonlyArray<{
  readonly section: Section;
  readonly path: `/${string}`;
}> = [
  { section: "home", path: homePath },
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
 * The mode, as one small control: a button showing the current mode's icon
 * that opens the three choices as a popover. Without JavaScript, as the
 * site is: the browser opens and closes a popover itself, on the button,
 * on Escape and on a click outside it, and returns focus to the button.
 * Each choice is a link to `?theme=` on this page, which the Worker
 * remembers and redirects from (theme.ts), so choosing reloads the page
 * closed. The button's accessible name says what it is and what is chosen;
 * the current choice says so with aria-current. Crawlers are asked not to
 * follow the links.
 */
function ModeSwitch({ theme }: { readonly theme: Theme | undefined }) {
  const current = theme ?? "system";
  const currentName =
    choices.find(({ choice }) => choice === current)?.label ?? current;
  return (
    <div class="mode">
      <button
        type="button"
        popovertarget="mode-choices"
        aria-label={`mode: ${currentName}`}
      >
        <ModeIcon choice={current} />
      </button>
      <ul id="mode-choices" class="at-type-meta" popover="auto">
        {choices.map(({ choice, label }) => (
          <li>
            <a
              href={`?theme=${choice}`}
              rel="nofollow"
              aria-current={choice === current ? "true" : undefined}
            >
              <ModeIcon choice={choice} />
              <span safe>{label}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The hosts sign off with their portraits from their speaker profiles, or
 * the brand's blank avatar where there is none. The originals are large
 * (684 to 2160 px, megabytes) and shown at 36, so with variants they come
 * at 36 and 72 pixels (see picture.tsx). Who they are, and what allthings
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
              alt={host.name}
            />
          ))}
        </span>
        <p>
          <a href={aboutPath} safe>
            {`hosted by ${hosts[0].name} & ${hosts[1].name}`}
          </a>
        </p>
      </div>
      <nav aria-label="allthings elsewhere">
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
  /** The hosts' portraits, by profile id, for the footer. */
  readonly portraits: PortraitsById;
  /** How photos are shown (see picture.tsx). */
  readonly images: ImageMode;
  /**
   * The header section the page belongs to, marked as current: home is its
   * own, and an evening's page belongs to the evenings. None for pages
   * outside them, such as /brand.
   */
  readonly section?: Section | undefined;
  /**
   * A page of the home lab (pages/lab/): its own stylesheet after the
   * site's, and a frame whose regions may run from edge to edge.
   */
  readonly lab?: true | undefined;
  /**
   * The lab's script (src/client/lab.ts), for a lab page with an engine:
   * a module of this site's, which its policy lets run.
   */
  readonly script?: true | undefined;
}

/** A whole HTML document around `children`, the page's <main>. */
export function Document({
  meta,
  origin,
  theme,
  portraits,
  images,
  section,
  lab,
  script,
  children,
}: PropsWithChildren<DocumentProps>): string {
  // Every page is in the visitor's mode, the system's until they choose.
  const shown = theme;
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
        {lab === undefined ? (
          ""
        ) : (
          <link rel="stylesheet" href={built.labStylesheet} />
        )}
        {script === undefined ? (
          ""
        ) : (
          <script type="module" src={built.labScript}></script>
        )}
        <link rel="icon" href={built.marks.favicon.src} type="image/svg+xml" />
        <link rel="apple-touch-icon" href={built.marks.appleTouchIcon.src} />
        <link rel="manifest" href="/manifest.webmanifest" />
      </head>
      <body>
        <a class="skip-link" href="#main">
          skip to the page
        </a>
        <div class={lab === undefined ? "page" : "page lab"}>
          <header class="site-header">
            <Wordmark />
            <div class="site-tools">
              <SiteNav section={section} />
              <ModeSwitch theme={theme} />
            </div>
          </header>
          <main id="main">{children}</main>
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
