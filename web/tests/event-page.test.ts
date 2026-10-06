import { describe, expect, test } from "bun:test";
import type {
  EventPage,
  Post,
  Speaker,
} from "allthings-core/src/event-page.ts";
import type { SafeHtml } from "allthings-core/src/rich-text.ts";
import { DateTime } from "effect";
import { googleMaps } from "../src/links.ts";
import {
  calendarFile,
  calendarFileName,
  calendarPath,
  calendarTitle,
  foldLine,
  icsInstant,
  icsText,
} from "../src/pages/calendar.ts";
import {
  eventLockupSize,
  eventPage,
  eventTitle,
  firstName,
  handleOf,
  notFoundPage,
  openFloorLine,
} from "../src/pages/event.tsx";
import { fullDate, timeRange } from "../src/pages/time.ts";
import type { ImageMode } from "../src/pages/picture.tsx";
import { htmlProblems } from "./support/pages.ts";

/** The event page and its calendar file, as pure functions of fixed data. */

const at = (iso: string) => DateTime.makeUnsafe(iso);
const origin = "https://allthings.dev";

const speaker = (overrides: Partial<Speaker> = {}): Speaker => ({
  id: "b1",
  name: "Ada Lovelace",
  title: "Engineer",
  bio: "Writes compilers.",
  links: { x: null, bluesky: null, linkedin: null },
  portrait: null,
  role: "speaker",
  ...overrides,
});

const event = (overrides: Partial<EventPage> = {}): EventPage => ({
  id: "e0000000-0000-4000-8000-000000000001",
  slug: "2026-09-30-all-things-effect",
  name: "Effect San Francisco",
  topic: "effect",
  tagline: "All Things Effect",
  status: "upcoming",
  mode: "night",
  startsAt: at("2026-10-01T00:30:00Z"),
  endsAt: at("2026-10-01T03:30:00Z"),
  updatedAt: at("2026-09-01T12:00:00Z"),
  venue: {
    neighborhood: "East Cut",
    name: null,
    address: "201 Spear St 12th floor, San Francisco, CA 94105, USA",
    mapQuery:
      "CodeRabbit, 201 Spear St 12th floor, San Francisco, CA 94105, USA",
  },
  hosts: ["CodeRabbit"],
  hostSites: {},
  organizers: [],
  coHosts: [],
  mcs: [],
  guests: null,
  rsvpUrl: "https://lu.ma/event/evt-effect",
  seats: 200,
  program: "talks",
  curation: { kind: "ours" },
  recordingUrl: null,
  talks: [],
  schedule: [],
  notes: [],
  photos: [],
  posts: [],
  morePosts: 0,
  next: undefined,
  ...overrides,
});

const render = (
  view: EventPage,
  theme?: "light" | "dark",
  images: ImageMode = "originals",
) =>
  eventPage({
    event: view,
    origin,
    theme,
    portraits: new Map(),
    images,
    now: at("2026-09-01T00:00:00Z"),
  });

/** The ledger's labels, in order. */
const labels = (html: string) =>
  [...html.matchAll(/<dt class="at-type-meta">([^<]+)<\/dt>/g)].map(
    ([, label]) => label,
  );

describe("times on an event page", () => {
  test.each([
    // An evening, already the next day in UTC.
    [
      "2026-10-01T00:30:00Z",
      "2026-10-01T03:30:00Z",
      "Wed Sep 30, 2026",
      "5:30–8:30 PM",
    ],
    // Morning to evening.
    [
      "2025-04-26T17:30:00Z",
      "2025-04-27T03:30:00Z",
      "Sat Apr 26, 2025",
      "10:30 AM–8:30 PM",
    ],
    // Past midnight: the day it ends is said too.
    [
      "2025-11-05T04:00:00Z",
      "2025-11-05T09:00:00Z",
      "Tue Nov 4, 2025",
      "8:00 PM – Wed Nov 5, 1:00 AM",
    ],
    // Noon to the afternoon.
    [
      "2026-07-04T19:00:00Z",
      "2026-07-04T21:00:00Z",
      "Sat Jul 4, 2026",
      "12:00–2:00 PM",
    ],
  ])("%s to %s is %s, %s", (start, end, date, range) => {
    expect(fullDate(at(start))).toBe(date);
    expect(timeRange(at(start), at(end))).toBe(range);
  });
});

describe("the lockup", () => {
  test.each([
    ["effect", "l", "all things/effect"],
    ["observables", "l", "all things/observables"],
    ["react native", "m", "all things/react native"],
  ] as const)("at/%s is set %s and titled %s", (topic, size, title) => {
    expect(eventLockupSize({ topic })).toBe(size);
    expect(eventTitle({ topic, name: "Anything" })).toBe(title);
  });

  test("a name without a topic is set small, as written, with the cursor until it has happened", () => {
    const name = "TypeScript AI: The official conference after-party";
    const upcoming = render(event({ topic: undefined, name }));
    expect(upcoming).toContain(
      `<h1 class="event-name event-name-s"><span>${name}</span><span class="at-cursor" aria-hidden="true">_</span></h1>`,
    );
    expect(upcoming).toContain(`<title>${name} · all things/_</title>`);
    const past = render(event({ topic: undefined, name, status: "past" }));
    expect(past).toContain(
      `<h1 class="event-name event-name-s"><span>${name}</span></h1>`,
    );
  });
});

describe("the mode", () => {
  test("is the visitor's, the system's until they choose, whatever the event's own mode", () => {
    // An evening (Night artwork) and a daytime event (Paper) alike follow
    // the system: neither has a mode of its own on the page.
    for (const mode of ["night", "paper"] as const) {
      const html = render(event({ mode }));
      expect(html).toStartWith('<!doctype html><html lang="en"><head>');
      expect(html).toContain(
        '<button type="button" popovertarget="mode-choices" aria-label="mode: system">',
      );
    }
    const fixed = render(event(), "light");
    expect(fixed).toStartWith(
      '<!doctype html><html lang="en" data-theme="light">',
    );
    expect(fixed).toContain('<meta name="color-scheme" content="light"/>');
    expect(fixed).toContain(
      '<button type="button" popovertarget="mode-choices" aria-label="mode: paper">',
    );
    expect(fixed).toMatch(
      /<a href="\?theme=light" rel="nofollow" aria-current="true"><svg[^]*?<\/svg><span>paper<\/span><\/a>/,
    );
    expect(fixed).toMatch(
      /<a href="\?theme=system" rel="nofollow"><svg[^]*?<\/svg><span>system<\/span><\/a>/,
    );
    expect(fixed).not.toContain("<span>event</span>");
    // An evening's page belongs to the evenings.
    expect(fixed).toContain('<a href="/events" aria-current="page">events</a>');
  });
});

describe("the ledger", () => {
  test("says where in the neighborhood's name, the venue's, and the address on the map", () => {
    const html = render(
      event({
        hosts: ["Convex"],
        venue: {
          neighborhood: "Potrero Hill",
          name: "Convex HQ",
          address: "444 De Haro St #218, San Francisco, CA 94107, USA",
          mapQuery: "444 De Haro St #218, San Francisco, CA 94107, USA",
        },
      }),
    );
    expect(html).toContain(
      `<p class="fact-head place">Potrero Hill</p><p class="venue">Convex HQ</p><p><a href="${googleMaps("444 De Haro St #218, San Francisco, CA 94107, USA")}"><span>444 De Haro St #218, San Francisco, CA 94107, USA</span>`,
    );
  });

  test("leads with the venue's name without a known neighborhood, and links no map without an address", () => {
    const html = render(
      event({
        venue: {
          neighborhood: null,
          name: "TBA",
          address: null,
          mapQuery: null,
        },
      }),
    );
    expect(html).toContain(
      '<dt class="at-type-meta">Where</dt><dd><p class="fact-head">TBA</p></dd>',
    );
    expect(html).not.toContain("google.com/maps");
  });

  test("encodes the map's query", () => {
    expect(googleMaps("Café & Bar, 1 Post St #3 ?")).toBe(
      "https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20%26%20Bar%2C%201%20Post%20St%20%233%20%3F",
    );
  });

  test("names several hosting companies in one line, and the hosts beside them", () => {
    const html = render(event({ hosts: ["Mux", "Strapi", "Neon"] }));
    expect(html).toContain('<p class="fact-head">Mux, Strapi &amp; Neon</p>');
    expect(html).toContain('<span class="at-type-meta">your hosts</span>');
  });

  test("links each hosting company with a site on record to it", () => {
    const html = render(
      event({
        hosts: ["Mux", "Strapi", "Neon"],
        hostSites: { Mux: "https://www.mux.com", Neon: "https://neon.com" },
      }),
    );
    expect(html).toContain(
      '<p class="fact-head"><a href="https://www.mux.com">Mux</a>, <span>Strapi</span> &amp; <a href="https://neon.com">Neon</a></p>',
    );
    const escaped = render(
      event({
        hosts: ['"Acme" & <Co>'],
        hostSites: { '"Acme" & <Co>': 'https://acme.example/?a="1"&b=<2>' },
      }),
    );
    expect(escaped).toContain(
      '<a href="https://acme.example/?a=&#34;1&#34;&b=<2>">&quot;Acme&quot; &amp; &lt;Co&gt;</a>',
    );
  });

  test("asks for seats only while there is a Luma page and the evening is ahead", () => {
    expect(labels(render(event({ rsvpUrl: null })))).not.toContain("Seats");
    const unknownSeats = render(event({ seats: null }));
    expect(unknownSeats).toContain(
      '<dt class="at-type-meta">Seats</dt><dd><div class="act"><a class="button"',
    );
    expect(labels(render(event({ status: "past" })))).not.toContain("Seats");
  });

  test("offers the recording once the evening is over, and only then", () => {
    const recordingUrl = "https://youtu.be/abc";
    expect(labels(render(event({ status: "past", recordingUrl })))).toContain(
      "Recording",
    );
    expect(labels(render(event({ recordingUrl })))).not.toContain("Recording");
    expect(labels(render(event({ status: "past" })))).not.toContain(
      "Recording",
    );
  });

  test("shows photos only once the evening is over", () => {
    const photos = [
      {
        url: "https://media.allthings.dev/events/a.jpg",
        alt: "The room",
        width: 1600,
        height: 1200,
        version: "1767323045",
      },
    ];
    expect(labels(render(event({ photos })))).not.toContain("Photos");
    expect(labels(render(event({ photos, status: "past" })))).toContain(
      "Photos",
    );
  });

  test("after an evening, opens the slot when nothing is announced", () => {
    const html = render(event({ status: "past" }));
    expect(labels(html)).toEqual(["When", "Where", "Hosted at", "Next"]);
    expect(html).toContain(
      '<p class="next-name">all things<span class="slash">/</span><span class="at-cursor" aria-hidden="true">_</span></p>',
    );
    expect(html).toContain(
      '<a href="https://luma.com/allthingsweb">subscribe on luma</a>',
    );
  });

  test("lists every speaker with only what is known about them", () => {
    const html = render(
      event({
        talks: [
          {
            id: "a1",
            title: "Two people, one talk",
            format: "talk",
            description: "<p>Hi</p>" as SafeHtml,
            speakers: [
              speaker({
                links: {
                  x: "https://twitter.com/@ada",
                  bluesky: "https://bsky.app/profile/ada.bsky.social",
                  linkedin: "https://www.linkedin.com/in/ada-lovelace",
                },
              }),
              speaker({ id: "b2", name: "Grace", title: null, bio: null }),
            ],
          },
        ],
      }),
    );
    expect(html).toContain(
      '<a href="https://bsky.app/profile/ada.bsky.social"><span>@ada.bsky.social</span><span class="visually-hidden">, Ada Lovelace on Bluesky</span></a>',
    );
    expect(html).toContain(
      '<a href="https://www.linkedin.com/in/ada-lovelace"><span>linkedin</span><span class="visually-hidden">, Ada Lovelace on LinkedIn</span></a>',
    );
    expect(html).toContain(
      '<div class="speaker-who"><h3 class="at-type-list-name"><a href="/people#p-b2">Grace</a></h3></div></article>',
    );
  });

  test("shows the schedule, then each note under its label, before the stage", async () => {
    const html = render(
      event({
        schedule: [
          { time: "5:00 pm", title: "Doors open", description: null },
          { time: "~7 pm", title: "<b>Hang out</b>", description: "a & b" },
        ],
        notes: [
          {
            label: "Awards",
            body: "<p>A <strong>PS5</strong></p>" as SafeHtml,
          },
          { label: "Theme", body: "<p>Two hours</p>" as SafeHtml },
        ],
        talks: [
          {
            id: "a1",
            title: "Live episode",
            format: "fireside",
            description: null,
            speakers: [speaker()],
          },
        ],
      }),
    );
    expect(labels(html)).toEqual([
      "When",
      "Where",
      "Hosted at",
      "Seats",
      "Schedule",
      "Awards",
      "Theme",
      "On stage",
    ]);
    expect(html).toContain(
      '<span class="schedule-time at-type-meta">5:00 pm</span><div class="schedule-step"><p class="schedule-title">Doors open</p></div>',
    );
    // Schedule text is escaped; a note's sanitized body is not.
    expect(html).toContain(
      '<p class="schedule-title">&lt;b&gt;Hang out&lt;/b&gt;</p><p class="schedule-description">a &amp; b</p>',
    );
    expect(html).toContain(
      '<div class="note"><p>A <strong>PS5</strong></p></div>',
    );
    expect(await htmlProblems(html)).toEqual([]);
  });

  test("leaves the schedule out when there is none", () => {
    expect(labels(render(event()))).not.toContain("Schedule");
  });

  test("says an open floor was open to anyone, in its tense, before the demos it knows", async () => {
    const demo = {
      id: "a1",
      title: "My agents.md",
      format: "talk" as const,
      description: null,
      speakers: [speaker()],
    };
    const past = render(
      event({ status: "past", program: "open-floor", talks: [demo] }),
    );
    expect(labels(past)).toContain("On stage");
    expect(past).toContain(
      `<div class="stage"><p class="stage-open at-type-lead">${openFloorLine("past")}</p><section class="stage-talk">`,
    );
    expect(openFloorLine("past")).toBe(
      "Open floor: anyone could get up and show what they were building.",
    );
    expect(await htmlProblems(past)).toEqual([]);
    // With no demos known, the floor is still said to have been open.
    const ahead = render(event({ program: "open-floor" }));
    expect(labels(ahead)).toContain("On stage");
    expect(ahead).toContain(
      "Open floor: anyone can get up and show what they’re building.",
    );
  });

  test("says who organizes an evening we only share, links out, and never calls it ours", async () => {
    const html = render(
      event({
        name: "TypeScript AI Demo Day",
        topic: undefined,
        hosts: [],
        curation: {
          kind: "shared",
          organizer: {
            name: "Mastra",
            websiteUrl: "https://mastra.ai",
            twitterHandle: "mastra",
            blueskyHandle: null,
            linkedinHandle: null,
          },
        },
      }),
    );
    expect(labels(html)).toContain("Organized by");
    expect(labels(html)).not.toContain("Hosted by");
    expect(html).toContain(
      '<p class="fact-head"><a href="https://mastra.ai/">Mastra</a></p><p>Not one of our evenings: we share it because we think it’s good.</p>',
    );
    expect(html).not.toContain("your hosts");
    expect(html).toContain("<span>TypeScript AI Demo Day</span>");
    expect(html).not.toContain('all things<span class="slash">/</span><wbr/>');
    expect(html).toContain(
      '"organizer":{"@type":"Organization","name":"Mastra","url":"https://mastra.ai/"}',
    );
    expect(await htmlProblems(html)).toEqual([]);
  });

  test("keeps a shared evening's co-hosts and MC, and names an organizer without a site with no url", () => {
    const person = {
      id: "p1",
      name: "Grace Hopper",
      title: "Admiral",
      portrait: null,
    };
    const html = render(
      event({
        coHosts: [person],
        mcs: [{ ...person, id: "p2", name: "Ada Lovelace" }],
        curation: {
          kind: "shared",
          organizer: {
            name: "Mastra",
            websiteUrl: null,
            twitterHandle: null,
            blueskyHandle: null,
            linkedinHandle: null,
          },
        },
      }),
    );
    expect(html).toContain("Grace Hopper");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain(
      '"organizer":{"@type":"Organization","name":"Mastra"}',
    );
  });

  test("gives a social evening or a hackathon no stage of its own, talks or not", () => {
    const talk = {
      id: "a1",
      title: "Opening words",
      format: "talk" as const,
      description: null,
      speakers: [speaker()],
    };
    for (const program of ["social", "hackathon"] as const) {
      expect(labels(render(event({ program })))).not.toContain("On stage");
      expect(labels(render(event({ program, talks: [talk] })))).not.toContain(
        "On stage",
      );
    }
    expect(labels(render(event({ talks: [talk] })))).toContain("On stage");
  });

  test("escapes what it prints", async () => {
    const html = render(
      event({
        topic: undefined,
        name: "<script>alert(1)</script>",
        hosts: ['"Acme" & <Co>'],
        talks: [
          {
            id: "a1",
            title: "<b>bold</b>",
            format: "talk",
            description: null,
            speakers: [speaker({ name: "<i>x</i>", bio: "a < b" })],
          },
        ],
      }),
    );
    // Attribute values may hold "<" as text; elements may not.
    const body = html.slice(html.indexOf("<body>"));
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("<b>bold");
    expect(html.match(/<script type="application\/ld\+json">/g)).toHaveLength(
      1,
    );
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&quot;Acme&quot; &amp; &lt;Co&gt;");
    expect(html).toContain("&lt;i&gt;x&lt;/i&gt;");
    expect(await htmlProblems(html)).toEqual([]);
  });

  test.each([
    ["upcoming", event()],
    ["live", event({ status: "live" })],
    ["past", event({ status: "past", recordingUrl: "https://youtu.be/x" })],
    ["bare", event({ venue: null, hosts: [], rsvpUrl: null, seats: null })],
  ])("is valid HTML: %s", async (_, view) => {
    expect(await htmlProblems(render(view))).toEqual([]);
  });

  test("not found is valid HTML", async () => {
    expect(
      await htmlProblems(
        notFoundPage({
          origin,
          path: "/nothing",
          theme: undefined,
          images: "originals",
          portraits: new Map(),
        }),
      ),
    ).toEqual([]);
  });
});

describe("handleOf", () => {
  test.each([
    ["https://twitter.com/ada", "ada"],
    ["https://twitter.com/@ada", "ada"],
    ["https://bsky.app/profile/ada.bsky.social", "ada.bsky.social"],
    ["https://www.linkedin.com/in/grace%20hopper", "grace hopper"],
  ])("%s is %s", (url, handle) => {
    expect(handleOf(url)).toBe(handle);
  });
});

describe("the calendar file", () => {
  test("is the event, built from its record alone", () => {
    expect(calendarFile(event(), origin)).toBe(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//all things//event page//EN",
        "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT",
        "UID:e0000000-0000-4000-8000-000000000001@allthings.dev",
        "DTSTAMP:20260901T120000Z",
        "DTSTART:20261001T003000Z",
        "DTEND:20261001T033000Z",
        "SUMMARY:see you at/effect",
        "LOCATION:CodeRabbit\\, 201 Spear St 12th floor\\, San Francisco\\, CA 94105\\, ",
        " USA",
        "DESCRIPTION:https://allthings.dev/2026-09-30-all-things-effect",
        "URL:https://allthings.dev/2026-09-30-all-things-effect",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
  });

  test("names an event without a topic as written, and leaves out an unknown place", () => {
    const file = calendarFile(
      event({ topic: undefined, name: "Demo day; v2", venue: null }),
      origin,
    );
    expect(file).toContain("\r\nSUMMARY:Demo day\\; v2\r\n");
    expect(file).not.toContain("LOCATION");
    expect(calendarTitle({ topic: "react native", name: "x" })).toBe(
      "see you at/react native",
    );
  });

  test("escapes text and writes instants in UTC", () => {
    expect(icsText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
    expect(icsInstant(at("2026-03-08T07:30:00.123Z"))).toBe("20260308T073000Z");
  });

  test("folds lines at 75 octets without splitting a character", () => {
    const line = `SUMMARY:${"é".repeat(60)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(new TextEncoder().encode(part).byteLength).toBeLessThanOrEqual(75);
    }
    expect(parts.slice(1).every((part) => part.startsWith(" "))).toBe(true);
    expect(
      parts.map((part, index) => (index === 0 ? part : part.slice(1))).join(""),
    ).toBe(line);
    expect(foldLine("short")).toBe("short");
  });

  test("lives beside the event's page, under a plain file name", () => {
    expect(calendarPath("2025-12-02-café-night")).toBe(
      "/2025-12-02-caf%C3%A9-night/calendar.ics",
    );
    expect(calendarFileName("2025-12-02-café-night")).toBe(
      "2025-12-02-cafe-night.ics",
    );
    expect(calendarFileName("¿?")).toBe("evening.ics");
  });
});

describe("who took part", () => {
  const person = (name: string, title: string | null = null) => ({
    id: name.toLowerCase().replaceAll(" ", "-"),
    name,
    title,
    portrait: null,
  });

  test("names the event's organizers as your hosts, by first name, else Erik and Andre", () => {
    const own = render(
      event({
        organizers: [person("Andre Landgraf"), person("Erik Thorelli")],
      }),
    );
    expect(own).toContain('<span class="host-names">Andre &amp; Erik</span>');
    const one = render(event({ organizers: [person("Andre Landgraf")] }));
    expect(one).toContain('<span class="at-type-meta">your host</span>');
    expect(one).toContain('<span class="host-names">Andre</span>');
    expect(render(event())).toContain(
      '<span class="host-names">Erik &amp; Andre</span>',
    );
    expect(firstName("  Sébastien Morel ")).toBe("Sébastien");
  });

  test("lists co-hosts and the MC with what they do, and leaves out who isn't there", () => {
    const html = render(
      event({
        coHosts: [
          person("Michael Arnaldi", "Creator of Effect"),
          person("Mirela Prifti"),
        ],
        mcs: [person("Ada Lovelace", "Engineer")],
      }),
    );
    expect(html).toContain('<p class="at-type-meta">co-hosts</p>');
    expect(html).toContain(
      '<a class="event-person-name" href="/people#p-michael-arnaldi"><span>Michael Arnaldi</span></a><span class="event-person-title">Creator of Effect</span>',
    );
    expect(html).toContain(
      '<a class="event-person-name" href="/people#p-mirela-prifti"><span>Mirela Prifti</span></a></p>',
    );
    expect(html).toContain('<p class="at-type-meta">mc</p>');
    expect(render(event({ coHosts: [person("Dan Goosewin")] }))).toContain(
      '<p class="at-type-meta">co-host</p>',
    );
    const none = render(event());
    expect(none).not.toContain("co-host");
    expect(none).not.toContain('class="event-people"');
  });

  test("says how many are going while it is ahead, and how many went after", () => {
    expect(render(event({ guests: 183 }))).toContain(
      "<p>183 going · 200 seats</p>",
    );
    expect(render(event({ guests: 183, seats: null }))).toContain(
      "<p>183 going</p>",
    );
    const past = render(event({ guests: 183, status: "past" }));
    expect(past).toContain("<p>183 went.</p>");
    expect(past).not.toContain("going");
    expect(render(event({ status: "past" }))).not.toContain("went");
  });

  test("names a panel or fireside chat, and each speaker's part in it", () => {
    const html = render(
      event({
        talks: [
          {
            id: "a1",
            title: "With its creator",
            format: "fireside",
            description: null,
            speakers: [
              speaker({ id: "m", name: "Simon", role: "moderator" }),
              speaker({ id: "g", name: "Michael", role: "guest" }),
            ],
          },
          {
            id: "a2",
            title: "A talk",
            format: "talk",
            description: null,
            speakers: [speaker()],
          },
        ],
      }),
    );
    expect(html).toContain(
      '<section class="stage-talk"><p class="at-type-meta">fireside chat</p><h2',
    );
    expect(html).toContain(
      '<p class="speaker-role at-type-meta">moderator</p><h3 class="at-type-list-name"><a href="/people#p-m">Simon</a></h3>',
    );
    expect(html).toContain(
      '<p class="speaker-role at-type-meta">guest</p><h3 class="at-type-list-name"><a href="/people#p-g">Michael</a></h3>',
    );
    // A talk's speaker is just its speaker.
    expect(html).toContain(
      '<section class="stage-talk"><h2 class="stage-title at-type-lead">A talk</h2>',
    );
    expect(html.match(/speaker-role/g)).toHaveLength(2);
  });
});

test("handleOf keeps a handle whose percent-encoding is malformed", () => {
  expect(handleOf("https://twitter.com/@bad%E0%A4%A")).toBe("bad%E0%A4%A");
});

describe("the event page's images as variants", () => {
  const photo = (name: string, width = 1600, height = 1200) => ({
    url: `https://media.allthings.dev/events/${name}.jpg`,
    alt: name,
    width,
    height,
    version: "1767323045",
  });
  const photos = Array.from({ length: 9 }, (_, index) => photo(`p${index}`));
  const html = render(
    event({
      status: "past",
      photos: [
        ...photos,
        { ...photo("elsewhere"), url: "https://elsewhere.example/x.jpg" },
      ],
      organizers: [
        { id: "e", name: "Erik", title: null, portrait: photo("erik") },
      ],
      talks: [
        {
          id: "t",
          title: "A talk",
          format: "talk",
          description: null,
          speakers: [speaker({ portrait: photo("ada", 800, 800) })],
        },
      ],
    }),
    undefined,
    "variants",
  );

  test("shows every photo the Worker can make variants of, sized for its tile, lazily", () => {
    const tiles = html.match(/<li><picture>.*?<\/picture><\/li>/g) ?? [];
    expect(tiles).toHaveLength(9);
    const sizes =
      "(max-width: 767.98px) calc(45.5vw - 6px), (max-width: 1439.98px) calc(22.75vw - 10px), 318px";
    expect(tiles[0]).toContain(
      `<img src="/img/480/jpeg/1767323045/events/p0.jpg" srcset="/img/240/jpeg/1767323045/events/p0.jpg 240w, /img/360/jpeg/1767323045/events/p0.jpg 360w, /img/480/jpeg/1767323045/events/p0.jpg 480w, /img/720/jpeg/1767323045/events/p0.jpg 720w, /img/960/jpeg/1767323045/events/p0.jpg 960w, /img/1200/jpeg/1767323045/events/p0.jpg 1200w" sizes="${sizes}" alt="p0" width="1600" height="1200" loading="lazy" decoding="async"/>`,
    );
    expect(html).not.toContain("elsewhere.example");
  });

  test("offers speakers at 72 to 336 pixels square and hosts at 72 and 144", () => {
    expect(html).toContain(
      '<img src="/img/72x72/jpeg/1767323045/events/ada.jpg" srcset="/img/72x72/jpeg/1767323045/events/ada.jpg 72w, /img/144x144/jpeg/1767323045/events/ada.jpg 144w, /img/168x168/jpeg/1767323045/events/ada.jpg 168w, /img/216x216/jpeg/1767323045/events/ada.jpg 216w, /img/336x336/jpeg/1767323045/events/ada.jpg 336w" sizes="(max-width: 767.98px) 72px, 168px" alt="" width="168" height="168" loading="lazy" decoding="async"/>',
    );
    expect(html).toContain(
      '<img src="/img/72x72/jpeg/1767323045/events/erik.jpg" srcset="/img/72x72/jpeg/1767323045/events/erik.jpg 72w, /img/144x144/jpeg/1767323045/events/erik.jpg 144w" sizes="44px" alt="" width="44" height="44" loading="lazy" decoding="async"/>',
    );
  });

  test("loads nothing from the media origin, and is valid HTML", async () => {
    expect(html).not.toContain("media.allthings.dev");
    expect(await htmlProblems(html)).toEqual([]);
  });
});

describe("posts about the evening", () => {
  const media = (name: string, width = 1200, height = 800) => ({
    url: `https://media.allthings.dev/posts/${name}.jpg`,
    alt: name,
    width,
    height,
    version: "1767323045",
  });
  const post = (overrides: Partial<Post> = {}): Post => ({
    url: "https://x.com/i/status/2105474023287341382",
    platform: "x",
    authorName: "Andre Landgraf",
    authorHandle: "andrelandgraf",
    authorUrl: "https://x.com/andrelandgraf",
    postedAt: at("2026-10-01T01:44:59Z"),
    text: "Effect 4.0 shipped IRL! 🔥",
    image: media("stage"),
    avatar: media("andre", 200, 200),
    ...overrides,
  });
  const bluesky = post({
    url: "https://bsky.app/profile/did:plc:x/post/3abc",
    platform: "bluesky",
    authorName: "Simon",
    authorHandle: "simon.example",
    authorUrl: null,
    postedAt: at("2026-10-01T05:00:00Z"),
    text: "Thanks, CodeRabbit!\nSee you next time.",
    image: null,
    avatar: null,
  });

  test("come after the photos and before what's next, for any evening that has them", () => {
    const photos = [media("room")];
    expect(
      labels(render(event({ status: "past", photos, posts: [post()] }))),
    ).toEqual(["When", "Where", "Hosted at", "Photos", "Posts", "Next"]);
    // An announcement shows before the evening, too.
    expect(labels(render(event({ posts: [post()] })))).toContain("Posts");
    expect(labels(render(event({ status: "past" })))).not.toContain("Posts");
  });

  test("keep their place among every row an evening can have", () => {
    const html = render(
      event({
        status: "past",
        rsvpUrl: null,
        recordingUrl: "https://youtu.be/abc",
        schedule: [{ time: "5 pm", title: "Doors open", description: null }],
        notes: [
          { label: "Awards", body: "<p>A PS5</p>" as SafeHtml },
          { label: "Theme", body: "<p>Two hours</p>" as SafeHtml },
        ],
        talks: [
          {
            id: "a1",
            title: "A talk",
            format: "talk",
            description: null,
            speakers: [speaker()],
          },
        ],
        photos: [media("room")],
        posts: [post()],
      }),
    );
    expect(labels(html)).toEqual([
      "When",
      "Where",
      "Hosted at",
      "Recording",
      "Schedule",
      "Awards",
      "Theme",
      "On stage",
      "Photos",
      "Posts",
      "Next",
    ]);
    // Seats, while the evening is ahead, take the recording's place.
    expect(
      labels(
        render(
          event({
            schedule: [
              { time: "5 pm", title: "Doors open", description: null },
            ],
            posts: [post()],
          }),
        ),
      ),
    ).toEqual(["When", "Where", "Hosted at", "Seats", "Schedule", "Posts"]);
  });

  test("say who posted, what, and when and where, linking to the post", () => {
    const html = render(event({ posts: [post(), bluesky] }));
    expect(html).toContain(
      '<a class="post-author" href="https://x.com/andrelandgraf"><span>Andre Landgraf</span></a><span class="post-handle">@andrelandgraf</span>',
    );
    expect(html).toContain(
      '<p class="post-text">Effect 4.0 shipped IRL! 🔥</p>',
    );
    expect(html).toContain(
      '<a href="https://x.com/i/status/2105474023287341382"><time datetime="2026-10-01T01:44:59.000Z">Wed Sep 30</time><span> on X</span><span aria-hidden="true"> →</span></a>',
    );
    // No profile link: the name alone. Line breaks stay as posted.
    expect(html).toContain(
      '<span class="post-author">Simon</span><span class="post-handle">@simon.example</span>',
    );
    expect(html).toContain(
      '<p class="post-text">Thanks, CodeRabbit!\nSee you next time.</p>',
    );
    expect(html).toContain("<span> on Bluesky</span>");
  });

  test("show the blank avatar for an author without one", () => {
    const html = render(event({ posts: [bluesky] }));
    expect(html).toMatch(
      /<li class="post"><img src="[^"]*avatar[^"]*" alt="" width="36" height="36" loading="lazy" decoding="async"\/>/,
    );
  });

  test("link to more on X only past the limit, and only with a Luma page", () => {
    const more = event({ posts: [post()], morePosts: 3 });
    expect(render(more)).toContain(
      '<a href="https://x.com/search?q=https%3A%2F%2Flu.ma%2Fevent%2Fevt-effect&f=live">more on X <span aria-hidden="true">→</span></a>',
    );
    expect(render(event({ posts: [post()] }))).not.toContain("more on X");
    expect(render(event({ ...more, rsvpUrl: null }))).not.toContain(
      "more on X",
    );
  });

  test("escape what was posted", async () => {
    const html = render(
      event({
        posts: [
          post({
            authorName: "<b>x</b>",
            authorHandle: "<i>",
            text: "<script>alert(1)</script> & more",
          }),
        ],
      }),
    );
    const body = html.slice(html.indexOf("<body>"));
    expect(body).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; more");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(await htmlProblems(html)).toEqual([]);
  });

  test("show their photos and avatars as variants, never from the platforms or the media origin", async () => {
    const html = render(
      event({ status: "past", posts: [post(), bluesky] }),
      undefined,
      "variants",
    );
    expect(html).toContain(
      '<img src="/img/480/jpeg/1767323045/posts/stage.jpg" srcset="/img/240/jpeg/1767323045/posts/stage.jpg 240w, /img/360/jpeg/1767323045/posts/stage.jpg 360w, /img/480/jpeg/1767323045/posts/stage.jpg 480w, /img/720/jpeg/1767323045/posts/stage.jpg 720w, /img/960/jpeg/1767323045/posts/stage.jpg 960w, /img/1200/jpeg/1767323045/posts/stage.jpg 1200w" sizes="(max-width: 767.98px) calc(91vw - 48px), 480px" alt="stage" width="1200" height="800" loading="lazy" decoding="async"/>',
    );
    expect(html).toContain(
      '<img src="/img/36x36/jpeg/1767323045/posts/andre.jpg" srcset="/img/36x36/jpeg/1767323045/posts/andre.jpg 1x, /img/72x72/jpeg/1767323045/posts/andre.jpg 2x" alt="" width="36" height="36" loading="lazy" decoding="async"/>',
    );
    expect(html).not.toContain("media.allthings.dev");
    expect(html).not.toContain("pbs.twimg.com");
    expect(html).not.toContain("<script src");
    expect(await htmlProblems(html)).toEqual([]);
  });
});
