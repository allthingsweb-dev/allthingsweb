import type {
  Event as SchemaEvent,
  Organization,
  Person,
  WithContext,
} from "schema-dts";
import { community } from "@/lib/community";
import type { ExpandedEvent } from "@/lib/expanded-events";

const organizationName = "All Things Web";

function organizationRef(origin: string) {
  return {
    "@type": "Organization",
    name: organizationName,
    url: origin,
  } as const satisfies Organization;
}

export function organizationJsonLd(origin: string): WithContext<Organization> {
  return {
    "@context": "https://schema.org",
    ...organizationRef(origin),
    description: community.oneLiner,
    logo: `${origin}/android-chrome-512.png`,
  };
}

export function eventJsonLd(
  event: ExpandedEvent,
  origin: string,
): WithContext<SchemaEvent> {
  const url = `${origin}/${encodeURIComponent(event.slug)}`;
  const performers = new Map<string, Person>();
  for (const speaker of event.talks.flatMap((talk) => talk.speakers)) {
    performers.set(speaker.id, {
      "@type": "Person",
      name: speaker.name,
      ...(speaker.title ? { jobTitle: speaker.title } : {}),
    });
  }
  const venueName = event.shortLocation ?? event.fullAddress;

  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.name,
    description: event.tagline,
    url,
    image: [`${origin}/api/v1/${encodeURIComponent(event.slug)}/preview.png`],
    startDate: event.startDate.toISOString(),
    endDate: event.endDate.toISOString(),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    isAccessibleForFree: true,
    organizer: organizationRef(origin),
    ...(venueName
      ? {
          location: {
            "@type": "Place",
            name: venueName,
            address: event.fullAddress ?? venueName,
          },
        }
      : {}),
    ...(performers.size > 0 ? { performer: [...performers.values()] } : {}),
    ...(event.lumaEventUrl
      ? {
          offers: {
            "@type": "Offer",
            url: event.lumaEventUrl,
            price: 0,
            priceCurrency: "USD",
            availability: "https://schema.org/InStock",
          },
        }
      : {}),
  };
}

/** Serializes JSON-LD so no value can close the surrounding script element. */
export function serializeJsonLd(data: object): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
