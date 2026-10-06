import { eventUrl } from "allthings-core/src/mappers.ts";
import { DateTime } from "effect";
import { personPath } from "../links.ts";
import type { FeedEvent, FeedPerson } from "./data.ts";
import { escapeXml } from "./xml.ts";

/**
 * The sitemap (sitemaps.org 0.9): the site's own pages, then every
 * published event's page. A pure function of the events and the origin, so
 * the same data always makes the same bytes.
 */

/**
 * The pages this site serves besides event pages, in the order they are
 * listed. tests/seo.test.ts fetches each one, so a page that is listed
 * here and not served fails. They change with deploys or with what is
 * announced, not with any one row, so they carry no lastmod.
 */
export const sitePages = [
  "/",
  "/events",
  "/people",
  "/about",
  "/code-of-conduct",
  "/brand",
] as const;

const url = (loc: string, lastmod?: DateTime.Utc) =>
  lastmod === undefined
    ? `  <url><loc>${escapeXml(loc)}</loc></url>`
    : `  <url><loc>${escapeXml(loc)}</loc><lastmod>${DateTime.formatIso(lastmod)}</lastmod></url>`;

/**
 * The sitemap of the site at `origin`. `events` are listed in the order
 * given (FeedData's: latest start first), each with when it last changed.
 */
export function sitemapXml(
  events: ReadonlyArray<FeedEvent>,
  origin: string,
  people: ReadonlyArray<FeedPerson> = [],
): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...sitePages.map((path) => url(`${origin}${path}`)),
    ...events.map((event) =>
      url(eventUrl(origin, event.slug), event.updatedAt),
    ),
    ...people.map((person) =>
      url(`${origin}${personPath(person.slug)}`, person.updatedAt),
    ),
    "</urlset>",
    "",
  ].join("\n");
}
