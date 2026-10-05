/**
 * Where all things is besides this site, and who hosts it. Every page's
 * footer reads them; brand/foundations.md ("People and channels") says how
 * they are shown.
 */

/** The community calendar on Luma, where people subscribe to every evening. */
export const lumaCalendar = "https://luma.com/allthingsweb";

/**
 * Where event photos are served from (R2). Pages load them as variants from
 * this site (see images/variants.ts); only a Worker without its Images
 * binding links them here, and then its Content-Security-Policy allows
 * images from this one other origin.
 */
export const mediaOrigin = "https://media.allthings.dev";

/** Every evening, listed: this site's evenings index (pages/events.tsx). */
export const everyEvening = "/events";

/** The community's Discord, where people talk between evenings. */
export const discord = "https://discord.gg/B3Sm4b5mfD";

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
  { name: "discord", href: discord },
  { name: "youtube", href: "https://www.youtube.com/@allthingsweb-dev" },
  { name: "github", href: "https://github.com/allthingsweb-dev/allthingsweb" },
  { name: "x", href: `https://x.com/${xHandle}` },
  { name: "bluesky", href: "https://bsky.app/profile/allthingsweb.dev" },
  {
    name: "linkedin",
    href: "https://www.linkedin.com/company/all-things-web-dev/",
  },
];

export interface Host {
  /** As "hosted by" names them: first names. */
  readonly name: string;
  /**
   * Their speaker profile's id, where their portrait comes from. Ids are
   * stable and names are not, so profiles are never matched by name.
   * Without a photo there, the brand's blank avatar stands in; there are no
   * stand-in photos.
   */
  readonly profileId: string;
}

/** The organizers, who sign off every page. */
export const hosts: readonly [Host, Host] = [
  // Erik Thorelli
  { name: "Erik", profileId: "717803b9-074f-47b9-adb7-ff3f2e520eee" },
  // Andre Landgraf
  { name: "Andre", profileId: "9527ccf6-8056-4225-b695-cb2a6e1ea50e" },
];

/**
 * A place on Google Maps: its search for `query`, such as a venue's
 * address, as Google's Maps URLs document it. A plain outbound link.
 */
export const googleMaps = (query: string): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
