import { eventPathOf } from "allthings-core/src/mappers.ts";
import { ourAccount } from "allthings-core/src/social/account.ts";

/**
 * Where allthings is besides this site, and who hosts it. Every page's
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

/**
 * An event's page on this site: its slug, encoded, so it is always one
 * segment, or two for a shared evening's link (shared/<name>, core's
 * src/short-slugs.ts). Links within the site are root-relative, so every stage's pages
 * link within that stage; only what names the production site itself (the
 * canonical URL, link previews, the sitemap, the feed and structured data)
 * is absolute, on `ORIGIN`.
 */
export const eventPath = (slug: string): `/${string}` => eventPathOf(slug);

/** Every evening, listed: this site's evenings index (pages/events.tsx). */
export const everyEvening = "/events";

/** What allthings is, where it came from and who organizes it. */
export const aboutPath = "/about";

/** Where everyone who organized, spoke at or co-hosted an evening is listed. */
export const peoplePage = "/people";

/**
 * A person's entry on the people page, by their profile's id: ids are
 * stable where names are not, so a link to someone never breaks or moves
 * to someone else of the same name.
 */
export const personAnchor = (profileId: string): string =>
  // Ids are uuids; anything else is spelled out, so an anchor is always a
  // plain token and two ids never share one.
  `p-${Array.from(profileId, (character) =>
    /[A-Za-z0-9-]/.test(character)
      ? character
      : `_${character.codePointAt(0)?.toString(16) ?? ""}_`,
  ).join("")}`;

/**
 * A person's own page, /people/<slug>: the slug comes from their name and
 * is unique (core/src/person-slug.ts); when the name changes, the old
 * address redirects to the new one for good.
 */
export const personPath = (slug: string): `/${string}` =>
  `${peoplePage}/${encodeURIComponent(slug)}`;

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
  { name: "bluesky", href: `https://bsky.app/profile/${ourAccount.handle}` },
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
