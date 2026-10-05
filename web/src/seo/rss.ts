import { eventUrl } from "allthings-core/src/mappers.ts";
import { DateTime } from "effect";
import { homeTitle, rssPath, siteDescription } from "../pages/metadata.tsx";
import type { FeedEvent } from "./data.ts";
import { escapeXml } from "./xml.ts";

/**
 * The RSS 2.0 feed of every published event, at /rss as on the current
 * site. Readers already subscribed know each item by its guid, the event's
 * id, which this feed keeps exactly as the app writes it
 * (app/src/lib/event-feeds.ts), so no item shows up twice after the move.
 *
 * A pure function of the events and the origin: where the app stamps the
 * time it built the feed, this one says when its content last changed.
 */

/**
 * When an event was announced: when it was created, unless it was imported
 * after it happened, which would make every past event new on the day it
 * was imported.
 */
const announcedAt = (event: FeedEvent): DateTime.Utc =>
  DateTime.min(event.createdAt, event.startDate);

/** An RFC 822 date, as RSS 2.0 writes them. */
const rfc822 = (date: DateTime.Utc) => DateTime.toDateUtc(date).toUTCString();

const item = (event: FeedEvent, origin: string) =>
  [
    "    <item>",
    `      <title>${escapeXml(event.name)}</title>`,
    `      <description>${escapeXml(event.tagline)}</description>`,
    `      <link>${escapeXml(eventUrl(origin, event.slug))}</link>`,
    `      <guid isPermaLink="false">urn:uuid:${escapeXml(event.id)}</guid>`,
    `      <pubDate>${rfc822(announcedAt(event))}</pubDate>`,
    "    </item>",
  ].join("\n");

/**
 * The feed of the site at `origin`. Items keep the order of `events`
 * (FeedData's: latest start first); the build date is the latest change to
 * any of them, and absent when there are none.
 */
export function rssXml(
  events: ReadonlyArray<FeedEvent>,
  origin: string,
): string {
  const [first, ...rest] = events.map((event) => event.updatedAt);
  const lastBuild =
    first === undefined
      ? []
      : [
          `    <lastBuildDate>${rfc822(rest.reduce<DateTime.Utc>((a, b) => DateTime.max(a, b), first))}</lastBuildDate>`,
        ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(homeTitle)}</title>`,
    `    <link>${escapeXml(`${origin}/`)}</link>`,
    `    <description>${escapeXml(siteDescription)}</description>`,
    "    <language>en-us</language>",
    `    <atom:link href="${escapeXml(`${origin}${rssPath}`)}" rel="self" type="application/rss+xml"/>`,
    ...lastBuild,
    ...events.map((event) => item(event, origin)),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
