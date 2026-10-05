import { eventUrl, rsvpUrl } from "allthings-core/src/mappers.ts";
import type * as Rows from "allthings-core/src/rows.ts";
import { DateTime } from "effect";
import { socials } from "../links.ts";

/**
 * schema.org data about a page, as JSON-LD in its head: who runs the site
 * on the home page, and the Event an event page is about. The shapes are
 * the few schema.org properties the site states, after
 * app/src/lib/structured-data.ts.
 */

const context = "https://schema.org";

/** The site's name in structured data, as metadata.tsx names the site. */
const organizationName = "all things";

interface OrganizationRef {
  readonly "@type": "Organization";
  readonly name: string;
  readonly url: string;
}

export interface Organization extends OrganizationRef {
  readonly "@context": typeof context;
  readonly description: string;
  /** Its profiles elsewhere, the footer's socials. */
  readonly sameAs: ReadonlyArray<string>;
}

interface Place {
  readonly "@type": "Place";
  readonly name: string;
  readonly address?: string;
}

interface Person {
  readonly "@type": "Person";
  readonly name: string;
  readonly jobTitle?: string;
}

interface Offer {
  readonly "@type": "Offer";
  readonly url: string;
  readonly price: 0;
  readonly priceCurrency: "USD";
  readonly availability: "https://schema.org/InStock";
}

export interface Event {
  readonly "@context": typeof context;
  readonly "@type": "Event";
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly eventStatus: "https://schema.org/EventScheduled";
  readonly eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode";
  readonly isAccessibleForFree: true;
  readonly organizer: OrganizationRef;
  readonly location?: Place;
  readonly performer?: ReadonlyArray<Person>;
  readonly offers?: Offer;
}

/** What a page may say about itself in its head. */
export type StructuredData = Organization | Event;

const organizer = (origin: string): OrganizationRef => ({
  "@type": "Organization",
  name: organizationName,
  url: origin,
});

/** The organization behind the site at `origin`, described by `description`. */
export function organization(
  origin: string,
  description: string,
): Organization {
  return {
    "@context": context,
    ...organizer(origin),
    description,
    sameAs: socials.map((social) => social.href),
  };
}

/**
 * The schema.org Event for a published event's page: when and where, who
 * speaks (each once, in the order they first appear), and where to sign
 * up. It names no image until event covers are rendered (the site has no
 * images of its own yet), and every evening is free and in person.
 */
export function eventStructuredData(
  event: Rows.EventDetails,
  origin: string,
): Event {
  const performers = new Map<string, Person>();
  for (const speaker of event.talks.flatMap((talk) => talk.speakers)) {
    if (performers.has(speaker.id)) continue;
    performers.set(speaker.id, {
      "@type": "Person",
      name: speaker.name,
      ...(speaker.title === "" ? {} : { jobTitle: speaker.title }),
    });
  }
  const venue = event.shortLocation ?? event.fullAddress;
  const signUp = rsvpUrl(event.lumaEventId);
  return {
    "@context": context,
    "@type": "Event",
    name: event.name,
    description: event.tagline,
    url: eventUrl(origin, event.slug),
    startDate: DateTime.formatIso(event.startDate),
    endDate: DateTime.formatIso(event.endDate),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    isAccessibleForFree: true,
    organizer: organizer(origin),
    ...(venue === null
      ? {}
      : {
          location: {
            "@type": "Place",
            name: venue,
            ...(event.fullAddress === null
              ? {}
              : { address: event.fullAddress }),
          },
        }),
    ...(performers.size === 0 ? {} : { performer: [...performers.values()] }),
    ...(signUp === null
      ? {}
      : {
          offers: {
            "@type": "Offer",
            url: signUp,
            price: 0,
            priceCurrency: "USD",
            availability: "https://schema.org/InStock",
          },
        }),
  };
}

/**
 * `data` as the text of a <script type="application/ld+json">. JSON may
 * hold "</script>" or "<!--" in any string; with every "<" written as
 * \u003c, no value can end the element or open a comment, and U+2028 and
 * U+2029 are escaped for parsers that read JSON as JavaScript. JSON.parse
 * reads it back unchanged.
 */
export function serializeJsonLd(data: StructuredData): string {
  return JSON.stringify(data)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
