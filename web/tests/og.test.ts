import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { roleColor, tokens } from "allthings-brand/src/tokens.ts";
import type { EventPage } from "allthings-core/src/event-page.ts";
import { DateTime } from "effect";
import { encode } from "uqr";
import type { OgMetrics } from "../scripts/build.ts";
import metrics from "../dist/og-metrics.json" with { type: "json" };
import {
  cardFacts,
  cardHeight,
  cardVersion,
  cardWidth,
  eventCard,
  layoutCard,
  textWidth,
} from "../src/og/event-card.ts";
import { qrPng } from "../src/og/qr.ts";

/** Event cards' layout and QR codes, as pure functions of fixed data. */

const measured: OgMetrics = metrics;

const event = (overrides: Partial<EventPage> = {}): EventPage => ({
  id: "e0000000-0000-4000-8000-000000000001",
  slug: "2026-09-30-all-things-effect",
  name: "Effect San Francisco",
  topic: "effect",
  tagline: "All Things Effect",
  status: "upcoming",
  mode: "night",
  startsAt: DateTime.makeUnsafe("2026-10-01T00:30:00Z"),
  endsAt: DateTime.makeUnsafe("2026-10-01T03:30:00Z"),
  updatedAt: DateTime.makeUnsafe("2026-09-01T12:00:00Z"),
  venue: {
    neighborhood: "East Cut",
    name: null,
    address: null,
    mapQuery: null,
  },
  hosts: ["CodeRabbit"],
  hostSites: {},
  organizers: [],
  coHosts: [],
  mcs: [],
  guests: null,
  rsvpUrl: null,
  seats: null,
  recordingUrl: null,
  talks: [],
  photos: [],
  posts: [],
  morePosts: 0,
  next: undefined,
  ...overrides,
});

const layout = (overrides: Partial<EventPage> = {}) =>
  layoutCard(cardFacts(event(overrides)), measured);

describe("an event's card", () => {
  test("says when, all things/<topic> with the cursor ahead, and where and who hosts", () => {
    const texts = layout();
    expect(texts.map(({ text, font }) => [font, text])).toEqual([
      ["meta", "WED SEP 30 · 5:30 PM"],
      ["label", "EAST CUT · CODERABBIT"],
      ["lockup", "all things"],
      ["lockup", "/"],
      ["lockup", "effect"],
      ["lockup", "_"],
    ]);
    const night = (role: string) => roleColor(tokens, "night", role).hex;
    const [meta, label, allThings, slash, topic, cursor] = texts;
    expect(meta?.color).toBe(night("meta"));
    expect(label?.color).toBe(night("link"));
    expect(allThings?.color).toBe(night("text"));
    expect(slash?.color).toBe(night("slash"));
    expect(cursor?.color).toBe(night("slash"));
    // The slash follows "all things"; the cursor follows the topic.
    expect(slash?.left).toBe(
      Math.round(
        (allThings?.left ?? 0) +
          textWidth(measured.lockup, "all things", allThings?.size ?? 0),
      ),
    );
    expect(cursor?.top).toBe(topic?.top);
    expect(topic?.size).toBe(132);
  });

  test("keeps every word inside the card's margins", () => {
    for (const overrides of [
      {},
      { topic: "typescript ai demo day and hackathon finals" },
      {
        topic: undefined,
        name: "TypeScript AI: The official conference after-party",
      },
      { hosts: ["Mux", "Strapi", "BigCommerce", "Neon", "Inngest", "Vercel"] },
      { topic: "a".repeat(80) },
      { topic: "pre next.js conf meetup" },
      { topic: "future of web hackathon", mode: "paper" as const },
    ]) {
      for (const run of layout(overrides)) {
        const font = measured[run.font];
        expect(run.left).toBeGreaterThanOrEqual(60);
        expect(
          run.left + textWidth(font, run.text, run.size),
        ).toBeLessThanOrEqual(cardWidth - 60);
        expect(run.top).toBeGreaterThanOrEqual(60);
        // The lockup keeps its distance from the meta line above it.
        if (run.font === "lockup")
          expect(run.top).toBeGreaterThanOrEqual(72 + 26 + 40);
        expect(run.top + run.size).toBeLessThanOrEqual(cardHeight - 40);
      }
    }
  });

  test("sets a long topic smaller, on two lines at most, and a name without one on three", () => {
    const long = layout({
      topic: "typescript ai demo day and hackathon finals",
    });
    const lines = long.filter(
      ({ font, text }) => font === "lockup" && text !== "_" && text !== "/",
    );
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines[0]?.size).toBeLessThan(132);
    const name = layout({
      topic: undefined,
      name: "TypeScript AI: The official conference after-party",
    }).filter(
      ({ font, text }) => font === "lockup" && text !== "_" && text !== "/",
    );
    expect(name.map(({ text }) => text)).not.toContain("all things");
    expect(name.length).toBeLessThanOrEqual(3);
  });

  test("drops the cursor once the evening is over, and is in Paper by day", () => {
    const past = layout({ status: "past" });
    expect(past.map(({ text }) => text)).not.toContain("_");
    const day = layout({ mode: "paper" });
    expect(day[0]?.color).toBe(roleColor(tokens, "paper", "meta").hex);
  });

  test("leaves out the label when neither the place nor the hosts are known", () => {
    expect(
      layout({ venue: null, hosts: [] }).map(({ font }) => font),
    ).not.toContain("label");
  });

  test("is named by its page with a version that changes when what it says does", () => {
    const card = eventCard(event(), "all things/effect");
    expect(card).toEqual({
      src: `/og/2026-09-30-all-things-effect.png?v=${cardVersion(cardFacts(event()))}`,
      width: 1200,
      height: 630,
      alt: "all things/effect · Wed Sep 30 · 5:30 PM · East Cut · CodeRabbit",
    });
    expect(cardVersion(cardFacts(event({ hosts: ["Clerk"] })))).not.toBe(
      cardVersion(cardFacts(event())),
    );
    // What the card doesn't say doesn't change it.
    expect(cardVersion(cardFacts(event({ tagline: "Another" })))).toBe(
      cardVersion(cardFacts(event())),
    );
  });
});

/** The palette indices of a PNG og/qr.ts writes, row by row. */
function pixels(png: Uint8Array): { side: number; rows: Array<Uint8Array> } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const side = view.getUint32(16);
  let at = 8;
  const idat: Array<Uint8Array> = [];
  while (at < png.byteLength) {
    const length = view.getUint32(at);
    const type = new TextDecoder().decode(png.subarray(at + 4, at + 8));
    if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rows = Array.from({ length: side }, (_, y) =>
    raw.subarray(y * (side + 1) + 1, (y + 1) * (side + 1)),
  );
  return { side, rows };
}

describe("QR codes", () => {
  const url = "https://allthings.dev/2026-09-30-all-things-effect";

  test("draw the code's modules, Ink on Paper, inside a four-module quiet zone", async () => {
    const png = await qrPng(url);
    const { data, size } = encode(url, { ecc: "M", border: 0 });
    const { side, rows } = pixels(png);
    const scale = side / (size + 8);
    expect(Number.isInteger(scale)).toBe(true);
    for (let y = 0; y < size + 8; y++) {
      for (let x = 0; x < size + 8; x++) {
        const module = data[y - 4]?.[x - 4] === true ? 1 : 0;
        const center = Math.floor(scale / 2);
        expect(rows[y * scale + center]?.[x * scale + center]).toBe(module);
      }
    }
    const palette = new TextDecoder("latin1").decode(png);
    expect(palette).toContain("PLTE");
  });

  test("are the same bytes for the same URL", async () => {
    expect(await qrPng(url)).toEqual(await qrPng(url));
  });
});
