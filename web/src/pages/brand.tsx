import {
  apcaContrast,
  textFloor,
  wcagContrast,
} from "allthings-brand/src/contrast.ts";
import { kebab } from "allthings-brand/src/css.ts";
import {
  type Color,
  colors,
  contrastRequirements,
  roleColor,
  tokens,
  type TypeRole,
  typeRoles,
} from "allthings-brand/src/tokens.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import { built } from "../assets.ts";
import { foundations } from "../foundations.ts";
import { Document } from "./document.tsx";
import { lockup } from "./metadata.tsx";
import type { ImageMode } from "./picture.tsx";
import { ogCards } from "../og/cards.ts";
import type { Theme } from "./theme.ts";

/**
 * /brand: the living style guide. The palette, the type scale and the marks
 * are drawn from the same tokens and files the site uses, with every
 * contrast figure computed here, followed by brand/foundations.md itself.
 */

const paper = roleColor(tokens, "paper", "ground");
const night = roleColor(tokens, "night", "ground");

/** "Bridge deep" for `bridgeDeep`. */
function displayName(name: string): string {
  const words = kebab(name).replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** APCA Lc and the WCAG 2 ratio, as brand/foundations.md quotes them. */
function contrast(text: Color, background: Color): ReadonlyArray<string> {
  if (text.hex === background.hex) return ["the ground"];
  const lc = Math.abs(apcaContrast(text.hex, background.hex)).toFixed(1);
  return [`Lc ${lc}`, `${wcagContrast(text.hex, background.hex).toFixed(1)}:1`];
}

function Sample({
  color,
  background,
  theme,
  label,
}: {
  readonly color: Color;
  readonly background: Color;
  readonly theme: Theme;
  readonly label: string;
}) {
  return (
    <div data-theme={theme}>
      <dt class="at-type-meta" safe>
        {label}
      </dt>
      <dd>
        {/* Text only where the pairing carries the sample's size; else a bar. */}
        {textFloor(apcaContrast(color.hex, background.hex)) === "small" ||
        textFloor(apcaContrast(color.hex, background.hex)) === "large" ? (
          <span class="sample-text" aria-hidden="true">
            Aa
          </span>
        ) : (
          <span class="sample-bar" aria-hidden="true"></span>
        )}
        {contrast(color, background).map((figure) => (
          <span class="figure" safe>
            {figure}
          </span>
        ))}
      </dd>
    </div>
  );
}

function Palette() {
  return (
    <section aria-labelledby="palette">
      <h2 id="palette" class="section-title at-type-label">
        Palette
      </h2>
      <ul class="swatches">
        {colors(tokens).map((color) => (
          <li class={`swatch at-swatch-${kebab(color.name)}`}>
            <div class="chip"></div>
            <h3 class="at-type-list-name" safe>
              {displayName(color.name)}
            </h3>
            <p class="figure">
              <code safe>{`--at-color-${kebab(color.name)}`}</code>
              <br />
              <span safe>{color.hex}</span>
            </p>
            <p class="use" safe>
              {color.description}
            </p>
            <dl class="samples">
              <Sample
                color={color}
                background={paper}
                theme="light"
                label="on paper"
              />
              <Sample
                color={color}
                background={night}
                theme="dark"
                label="on night"
              />
            </dl>
          </li>
        ))}
      </ul>
      <h3 class="at-type-list-name">Pairings and their targets</h3>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard users need focus to scroll this wide table (WCAG 2.1.1) */}
      <section class="scroll" aria-label="Pairings" tabindex="0">
        <table class="pairs">
          <thead>
            <tr>
              <th scope="col">Use</th>
              <th scope="col">Sample</th>
              <th scope="col">APCA Lc</th>
              <th scope="col">Target</th>
              <th scope="col">WCAG 2</th>
            </tr>
          </thead>
          <tbody>
            {contrastRequirements(tokens).map((pair) => (
              <tr>
                <td safe>{pair.use}</td>
                <td>
                  <span
                    class={`sample sample-${textFloor(pair.minLc) ?? "display"} at-swatch-${kebab(pair.background.name)}`}
                  >
                    <span
                      class={`at-swatch-${kebab(pair.text.name)}`}
                      safe
                    >{`${displayName(pair.text.name)} on ${displayName(pair.background.name)}`}</span>
                  </span>
                </td>
                <td safe>
                  {Math.abs(
                    apcaContrast(pair.text.hex, pair.background.hex),
                  ).toFixed(1)}
                </td>
                <td>{pair.minLc}</td>
                <td
                  safe
                >{`${wcagContrast(pair.text.hex, pair.background.hex).toFixed(1)}:1`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}

/** "−4.5%", "+6%", "0": tracking as the type table writes it. */
function tracking(em: number): string {
  if (em === 0) return "0";
  const percent = `${Math.abs(Math.round(em * 1000) / 10)}%`;
  return em < 0 ? `−${percent}` : `+${percent}`;
}

function spec(role: TypeRole): string {
  const size =
    role.family === "mono"
      ? `${role.size} / ${role.lineHeight} · Geist Mono`
      : `${role.size} / ${role.lineHeight}`;
  return [
    size,
    String(role.weight),
    ...(role.width === undefined ? [] : [role.width]),
    tracking(role.letterSpacingEm),
    ...(role.uppercase ? ["caps"] : []),
  ].join(" · ");
}

/** What each role is set in on the page. */
function Specimen({ role }: { readonly role: TypeRole }) {
  const className = `specimen at-type-${kebab(role.name)}`;
  switch (role.name) {
    case "wordmark":
      return (
        <p class={className}>
          allthings<span class="slash">/</span>
          <span class="at-cursor">_</span>
        </p>
      );
    case "eventLockup":
      return (
        <p class={className}>
          allthings<span class="slash">/</span>effect
          <span class="at-cursor">_</span>
        </p>
      );
    case "label":
      return <p class={className}>East Cut · CodeRabbit</p>;
    case "lead":
      return (
        <p class={className}>
          Evenings for people who build software. In the neighborhoods of San
          Francisco.
        </p>
      );
    case "statement":
      return (
        <p class={className}>
          Evenings for people who build software. In the neighborhoods of San
          Francisco.
        </p>
      );
    case "listName":
      return (
        <p class={className}>
          at<span class="slash">/</span>react native
        </p>
      );
    case "listPlace":
      return <p class={`${className} place`}>Potrero Hill</p>;
    case "body":
      return (
        <p class={className}>
          An open door and a high bar. Everyone who builds software is welcome;
          what goes on stage has earned its place.
        </p>
      );
    case "meta":
      return (
        <p class={className}>
          2026.09.30 · 5:30–8:30 PM · allthings.dev/effect
        </p>
      );
    default:
      return (
        <p class={className} safe>
          {role.description}
        </p>
      );
  }
}

function TypeScale() {
  return (
    <section aria-labelledby="type">
      <h2 id="type" class="section-title at-type-label">
        Type
      </h2>
      <p>
        One family, Archivo, at three widths, and Geist Mono for meta. Sizes are
        in pixels; large specimens shrink to fit narrow screens.
      </p>
      <div class="type-scale">
        {typeRoles(tokens).map((role) => (
          <div class="type-row">
            <p class="spec at-type-meta">
              <span safe>{displayName(role.name)}</span>
              <br />
              <span safe>{spec(role)}</span>
            </p>
            <Specimen role={role} />
          </div>
        ))}
      </div>
    </section>
  );
}

function MarkTile({
  image,
  alt,
  caption,
  theme,
  size,
}: {
  readonly image: {
    readonly src: string;
    readonly width: number;
    readonly height: number;
  };
  readonly alt: string;
  readonly caption: string;
  readonly theme: Theme;
  readonly size: "wide" | "small";
}) {
  return (
    <figure class={`mark-tile ${size}`} data-theme={theme}>
      <img
        src={image.src}
        alt={alt}
        width={String(image.width)}
        height={String(image.height)}
      />
      <figcaption class="at-type-meta" safe>
        {caption}
      </figcaption>
    </figure>
  );
}

function Marks() {
  const { marks } = built;
  return (
    <section aria-labelledby="marks">
      <h2 id="marks" class="section-title at-type-label">
        Marks
      </h2>
      <p>
        Generated as outlines by brand/marks, so they need no font. The slash is
        Bridge on light grounds and Glow on Night.
      </p>
      <div class="marks">
        <MarkTile
          image={marks.wordmark}
          alt="allthings/_"
          caption="wordmark · paper"
          theme="light"
          size="wide"
        />
        <MarkTile
          image={marks.wordmarkNight}
          alt="allthings/_"
          caption="wordmark · night"
          theme="dark"
          size="wide"
        />
        <MarkTile
          image={marks.mark}
          alt="a/"
          caption="logo · paper"
          theme="light"
          size="small"
        />
        <MarkTile
          image={marks.markNight}
          alt="a/"
          caption="logo · night"
          theme="dark"
          size="small"
        />
        <MarkTile
          image={marks.icon}
          alt="a/ on a Night tile"
          caption="app icon"
          theme="light"
          size="small"
        />
        <MarkTile
          image={marks.favicon}
          alt="a/, heavier for small sizes"
          caption="favicon"
          theme="light"
          size="small"
        />
        <MarkTile
          image={marks.avatar}
          alt="/_ on Night"
          caption="blank avatar, for people without a photo"
          theme="light"
          size="small"
        />
      </div>
    </section>
  );
}

let content: string | undefined;

/**
 * The page's <main>: a function of the build alone, the same in every mode,
 * so it is rendered once per isolate.
 */
function brandContent(): string {
  if (content === undefined) {
    const safeFoundations = foundations.html;
    const rendered = (
      <>
        <div class="intro">
          <p class="at-type-meta">brand · the living style guide</p>
          <h1 class="lockup at-type-event-lockup">
            allthings<span class="slash">/</span>brand
          </h1>
          <p class="lead at-type-lead">
            Palette, type and marks, drawn from the tokens the site is built
            with. Where this page and the foundations disagree, the foundations
            win.
          </p>
        </div>
        <Palette />
        <TypeScale />
        <Marks />
        <div class="prose">{safeFoundations}</div>
      </>
    );
    // Components here are synchronous, so it is a string, never a promise.
    if (typeof rendered !== "string") {
      throw new Error("/brand rendered asynchronously");
    }
    content = rendered;
  }
  return content;
}

export interface BrandProps {
  /** The production origin, for the canonical URL. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for the footer. */
  readonly portraits: PortraitsById;
  /** How photos are shown (see picture.tsx). */
  readonly images: ImageMode;
}

/** The whole of /brand, in the visitor's mode, signed off by the hosts. */
export function brandPage({
  origin,
  theme,
  portraits,
  images,
}: BrandProps): string {
  return Document({
    meta: {
      title: lockup("brand"),
      description:
        "The allthings/_ brand: palette, type, marks and the rules they follow.",
      path: "/brand",
      image: ogCards.brand,
    },
    origin,
    theme,
    portraits,
    images,
    children: brandContent(),
  });
}
