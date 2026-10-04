/**
 * Where all things is besides this site, and who hosts it. Every page's
 * footer reads them; brand/foundations.md ("People and channels") says how
 * they are shown.
 */

/** The community calendar on Luma, where people subscribe to every evening. */
export const lumaCalendar = "https://luma.com/allthingsweb";

/**
 * Where event photos are served from (R2). It is the one other origin a
 * page may load from, and only images; the Content-Security-Policy says so.
 */
export const mediaOrigin = "https://media.allthings.dev";

/**
 * Every evening, listed. The current site lists them on its home page, so
 * that is where "every evening" goes until this site has its own list.
 */
export const everyEvening = (origin: string): string => `${origin}/`;

/** The X account's handle, without the @. Its URL and mentions derive from it. */
export const xHandle = "allthingswebdev";

export interface Social {
  /** The channel's name as the footer prints it: lowercase, one word. */
  readonly name: string;
  readonly href: string;
}

/** In the order the footer lists them. */
export const socials: ReadonlyArray<Social> = [
  { name: "luma", href: lumaCalendar },
  { name: "discord", href: "https://discord.gg/B3Sm4b5mfD" },
  { name: "youtube", href: "https://www.youtube.com/@allthingsweb-dev" },
  { name: "github", href: "https://github.com/allthingsweb-dev/allthingsweb" },
  { name: "x", href: `https://x.com/${xHandle}` },
  { name: "bluesky", href: "https://bsky.app/profile/allthingsweb.dev" },
];

export interface Host {
  readonly name: string;
  /**
   * A portrait's URL on this site. Without one, the brand's blank avatar
   * stands in; there are no stand-in photos.
   */
  readonly portrait?: string;
}

/** The organizers, who sign off every page. */
export const hosts: readonly [Host, Host] = [
  { name: "Erik" },
  { name: "Andre" },
];
