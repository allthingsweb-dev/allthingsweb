import type { PropsWithChildren } from "@kitajs/html";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import { built } from "../assets.ts";
import { hosts, socials } from "../links.ts";
import { Metadata, type PageMeta } from "./metadata.tsx";
import { choices, type Theme } from "./theme.ts";

/**
 * The frame of every page: the document, the header with the wordmark and
 * the mode, and the footer that signs off with the hosts and the socials.
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

/**
 * The mode: the system's, Paper or Night. Each choice is a link to
 * `?theme=` on this page, which the Worker remembers and redirects from;
 * the current one says so with aria-current. Crawlers are asked not to
 * follow them. On a page with a mode of its own, such as an event's, the
 * first choice is that mode rather than the system's, and says so.
 */
function ModeSwitch({
  theme,
  pageTheme,
}: {
  readonly theme: Theme | undefined;
  readonly pageTheme: Theme | undefined;
}) {
  const current = theme ?? "system";
  return (
    <nav class="modes at-type-meta" aria-labelledby="mode">
      <span id="mode">mode</span>
      <ul>
        {choices.map(({ choice, label: name }) => {
          const label =
            choice === "system" && pageTheme !== undefined ? "event" : name;
          return (
            <li>
              <a
                href={`?theme=${choice}`}
                rel="nofollow"
                aria-current={choice === current ? "true" : undefined}
                safe
              >
                {label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The hosts sign off with their portraits from their speaker profiles, or
 * the brand's blank avatar where there is none. The originals are large
 * (684 to 2160 px) and shown at 36, so they load lazily, last, and off the
 * main thread; resized variants come with the image pipeline.
 */
function Footer({ portraits }: { readonly portraits: PortraitsById }) {
  return (
    <footer class="site-footer">
      <div class="hosts">
        <span class="portraits">
          {hosts.map((host) => (
            <img
              src={portraits.get(host.profileId)?.url ?? built.marks.avatar.src}
              alt=""
              width="36"
              height="36"
              loading="lazy"
              decoding="async"
              fetchpriority="low"
            />
          ))}
        </span>
        <p safe>{`hosted by ${hosts[0].name} & ${hosts[1].name}`}</p>
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
}

/** A whole HTML document around `children`, the page's <main>. */
export function Document({
  meta,
  origin,
  theme,
  pageTheme,
  portraits,
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
      </head>
      <body>
        <div class="page">
          <header class="site-header">
            <Wordmark />
            <ModeSwitch theme={theme} pageTheme={pageTheme} />
          </header>
          <main>{children}</main>
          <Footer portraits={portraits} />
        </div>
      </body>
    </html>
  );
  // Components here are synchronous, so the page is a string, never a promise.
  if (typeof page !== "string")
    throw new Error("A page rendered asynchronously");
  return `<!doctype html>${page}`;
}
