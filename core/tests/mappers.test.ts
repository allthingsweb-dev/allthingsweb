import { describe, expect, test } from "bun:test";
import { DateTime, Schema } from "effect";
import * as Contract from "../src/contract.ts";
import * as Mappers from "../src/mappers.ts";
import { htmlToPlainText, sanitizeRichText } from "../src/rich-text.ts";
import type * as Rows from "../src/rows.ts";

const origin = "https://allthingsweb.dev";
const at = (iso: string) => DateTime.makeUnsafe(iso);

const event: Rows.Event = {
  id: "e0000000-0000-4000-8000-000000000001",
  slug: "2026-08-12-react-at-acme",
  name: "React at Acme",
  tagline: "Server components in practice",
  startDate: at("2026-08-13T01:00:00Z"),
  endDate: at("2026-08-13T04:00:00Z"),
  streetAddress: null,
  shortLocation: null,
  fullAddress: null,
  lumaEventId: null,
  recordingUrl: null,
  isHackathon: false,
  previewImage: null,
};

describe("eventStatus", () => {
  test.each([
    ["2026-08-13T00:59:59.999Z", "upcoming"],
    ["2026-08-13T01:00:00.000Z", "live"],
    ["2026-08-13T04:00:00.000Z", "live"],
    ["2026-08-13T04:00:00.001Z", "past"],
  ] as const)("at %s it is %s", (now, status) => {
    expect(Mappers.eventStatus(event, at(now))).toBe(status);
  });
});

describe("httpUrlOrNull", () => {
  test.each([
    [null, null],
    ["", null],
    ["not a url", null],
    ["javascript:alert(1)", null],
    ["ftp://files.example.com/talk.mp4", null],
    ["mailto:hello@allthings.dev", null],
    // The contract only accepts domain-name hosts; the app would publish these.
    ["https://localhost/video", null],
    ["http://127.0.0.1:8080/", null],
    [
      "https://www.youtube.com/watch?v=abc",
      "https://www.youtube.com/watch?v=abc",
    ],
    ["HTTPS://YouTube.com/a b", "https://youtube.com/a%20b"],
    ["https://example.com", "https://example.com/"],
  ] as const)("%j becomes %j", (input, output) => {
    expect(Mappers.httpUrlOrNull(input)).toBe(output);
  });
});

describe("toEventSummary", () => {
  test("never publishes a value the contract rejects", () => {
    const summary = Mappers.toEventSummary(
      {
        ...event,
        recordingUrl: "https://localhost/video",
        lumaEventId: "evt x",
      },
      origin,
      at("2026-10-03T19:00:00Z"),
    );
    expect(summary.recordingUrl).toBeNull();
    expect(summary.rsvpUrl).toBe("https://lu.ma/event/evt%20x");
    expect(Schema.decodeUnknownSync(Contract.EventSummary)(summary)).toEqual(
      summary,
    );
  });

  test("shows a venue when either its name or address is known", () => {
    const now = at("2026-10-03T19:00:00Z");
    const venue = (shortLocation: string | null, fullAddress: string | null) =>
      Mappers.toEventSummary(
        { ...event, shortLocation, fullAddress },
        origin,
        now,
      ).venue;
    expect(venue(null, null)).toBeNull();
    expect(venue("Acme HQ", null)).toEqual({ name: "Acme HQ", address: null });
    expect(venue(null, "1 Market St")).toEqual({
      name: null,
      address: "1 Market St",
    });
  });
});

describe("selectEvents", () => {
  const now = at("2026-10-03T19:00:00Z");
  const make = (slug: string, start: string, end: string) => ({
    slug,
    startDate: at(start),
    endDate: at(end),
  });
  const events = [
    make("later", "2026-11-01T00:00:00Z", "2026-11-01T03:00:00Z"),
    make("tied-a", "2026-10-10T00:00:00Z", "2026-10-10T03:00:00Z"),
    make("tied-b", "2026-10-10T00:00:00Z", "2026-10-10T03:00:00Z"),
    make("live", "2026-10-03T18:00:00Z", "2026-10-03T19:00:00Z"),
    make("past", "2026-09-01T00:00:00Z", "2026-09-01T03:00:00Z"),
    make("older", "2026-01-01T00:00:00Z", "2026-01-01T03:00:00Z"),
  ];
  const slugs = (when: Mappers.EventSelection) =>
    Mappers.selectEvents(events, when, now).map((e) => e.slug);

  test("upcoming includes live events, soonest first, ties in input order", () => {
    expect(slugs("upcoming")).toEqual(["live", "tied-a", "tied-b", "later"]);
  });
  test("past is most recent first", () => {
    expect(slugs("past")).toEqual(["past", "older"]);
  });
  test("all is most recent first", () => {
    expect(slugs("all")).toEqual([
      "later",
      "tied-a",
      "tied-b",
      "live",
      "past",
      "older",
    ]);
  });
});

describe("talk descriptions", () => {
  const plain = (html: string) => htmlToPlainText(sanitizeRichText(html));

  test.each([
    ["<p>One</p><p>Two</p>", "One\nTwo"],
    ["<ul><li>a</li><li>b</li></ul>", "- a\n- b"],
    ["<p>a&nbsp;b &amp; c &lt;d&gt;</p>", "a b & c <d>"],
    ["Line<br/>break", "Line\nbreak"],
    ["<p>x</p><p></p><p></p><p></p><p>y</p>", "x\n\ny"],
    ['<script>alert(1)</script><a href="javascript:x">link</a>', "link"],
  ])("%j reads as %j", (html, text) => {
    expect(plain(html)).toBe(text);
  });
});
