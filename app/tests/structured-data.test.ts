import { describe, expect, test } from "bun:test";
import type { ExpandedEvent } from "../src/lib/expanded-events";
import { sanitizeRichText } from "../src/lib/safe-html";
import {
  eventJsonLd,
  organizationJsonLd,
  serializeJsonLd,
} from "../src/lib/structured-data";

const origin = "https://allthingsweb.dev";

const speaker = {
  id: "michael",
  name: "Michael Arnaldi",
  title: "Creator of Effect",
  image: { url: "/m.png", alt: "" },
  bio: "",
  socials: {},
};

const event: ExpandedEvent = {
  id: "e1",
  name: "Effect San Francisco",
  tagline: "An evening with Michael Arnaldi",
  slug: "2026-09-30-effect",
  startDate: new Date("2026-10-01T00:30:00Z"),
  endDate: new Date("2026-10-01T03:30:00Z"),
  attendeeLimit: 0,
  streetAddress: null,
  shortLocation: "CodeRabbit",
  fullAddress: "201 Spear St, San Francisco, CA 94105",
  lumaEventId: "evt-1",
  lumaEventUrl: "https://lu.ma/event/evt-1",
  isHackathon: false,
  isDraft: false,
  highlightOnLandingPage: false,
  previewImage: null,
  recordingUrl: null,
  hackathonState: null,
  hackStartedAt: null,
  hackUntil: null,
  voteStartedAt: null,
  voteUntil: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  images: [],
  hosts: [],
  talks: [
    {
      id: "t1",
      title: "Fireside",
      description: sanitizeRichText(""),
      speakers: [speaker],
    },
    {
      id: "t2",
      title: "Q&A",
      description: sanitizeRichText(""),
      speakers: [speaker],
    },
  ],
};

describe("structured data", () => {
  test("describes an in-person, free event with its venue, speakers and RSVP", () => {
    expect(eventJsonLd(event, origin)).toEqual({
      "@context": "https://schema.org",
      "@type": "Event",
      name: "Effect San Francisco",
      description: "An evening with Michael Arnaldi",
      url: "https://allthingsweb.dev/2026-09-30-effect",
      image: ["https://allthingsweb.dev/api/v1/2026-09-30-effect/preview.png"],
      startDate: "2026-10-01T00:30:00.000Z",
      endDate: "2026-10-01T03:30:00.000Z",
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      isAccessibleForFree: true,
      organizer: {
        "@type": "Organization",
        name: "All Things Web",
        url: origin,
      },
      location: {
        "@type": "Place",
        name: "CodeRabbit",
        address: "201 Spear St, San Francisco, CA 94105",
      },
      performer: [
        {
          "@type": "Person",
          name: "Michael Arnaldi",
          jobTitle: "Creator of Effect",
        },
      ],
      offers: {
        "@type": "Offer",
        url: "https://lu.ma/event/evt-1",
        price: 0,
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
      },
    });
  });

  test("omits location, performers and offers it cannot state", () => {
    const data = eventJsonLd(
      {
        ...event,
        shortLocation: null,
        fullAddress: null,
        lumaEventUrl: null,
        talks: [],
      },
      origin,
    );
    expect(data).not.toHaveProperty("location");
    expect(data).not.toHaveProperty("performer");
    expect(data).not.toHaveProperty("offers");
  });

  test("names a venue without inventing an address for it", () => {
    const data = eventJsonLd({ ...event, fullAddress: null }, origin);
    expect(data).toMatchObject({
      location: { "@type": "Place", name: "CodeRabbit" },
    });
    expect((data as { location: object }).location).not.toHaveProperty(
      "address",
    );
  });

  test("describes the organization", () => {
    expect(organizationJsonLd(origin)).toMatchObject({
      "@type": "Organization",
      name: "All Things Web",
      url: origin,
      logo: `${origin}/android-chrome-512.png`,
    });
  });

  test("serialization cannot close the surrounding script element", () => {
    const json = serializeJsonLd({
      name: "</script><script>alert(1)</script>",
    });
    expect(json).not.toContain("</script>");
    expect(JSON.parse(json)).toEqual({
      name: "</script><script>alert(1)</script>",
    });
  });
});
