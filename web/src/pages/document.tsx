import type { PropsWithChildren } from "@kitajs/html";
import { dataTheme } from "allthings-brand/src/css.ts";
import { type Mode, roleColor, tokens } from "allthings-brand/src/tokens.ts";
import { built } from "../assets.ts";
import { hosts, socials } from "../links.ts";

/**
 * The frame of every page: the document, the header with the wordmark, and
 * the footer that signs off with the hosts and the socials. Pages are
 * server-rendered HTML with no JavaScript; the cursor blinks in CSS.
 */

/** A page's mode, when it fixes one; otherwise it follows the system. */
export type Theme = (typeof dataTheme)[Mode];

const themes: ReadonlyArray<Theme> = Object.values(dataTheme);

export function isTheme(value: string | null): value is Theme {
  return themes.some((theme) => theme === value);
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

function Footer() {
  return (
    <footer class="site-footer">
      <div class="hosts">
        <span class="portraits">
          {hosts.map((host) => (
            <img
              src={host.portrait ?? built.marks.avatar.src}
              alt=""
              width="36"
              height="36"
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
  /** The page's own title; the document title adds nothing to it. */
  readonly title: string;
  readonly description: string;
  readonly theme: Theme | undefined;
}

/** A whole HTML document around `children`, the page's <main>. */
export function Document({
  title,
  description,
  theme,
  children,
}: PropsWithChildren<DocumentProps>): string {
  const fonts = built.fonts.filter((font) => font.preload);
  const page = (
    <html lang="en" data-theme={theme}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title safe>{title}</title>
        <meta name="description" content={description} />
        <ThemeColor theme={theme} />
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
          </header>
          <main>{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
  // Components here are synchronous, so the page is a string, never a promise.
  if (typeof page !== "string")
    throw new Error("A page rendered asynchronously");
  return `<!doctype html>${page}`;
}
