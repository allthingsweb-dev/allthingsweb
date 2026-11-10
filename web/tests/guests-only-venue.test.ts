import { describe, expect } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { migratedDatabase } from "allthings-core/tests/support/database.ts";
import * as Effect from "effect/Effect";
import { calendarPath } from "../src/pages/calendar.ts";
import { mcpRequest, rpcMessage } from "./support/http.ts";
import { serve } from "./support/socket.ts";
import { testStack } from "./support/stack.ts";

/**
 * An evening whose venue Luma shows to approved guests only
 * (`events.venue_guests_only`), on every public surface the Worker serves,
 * in workerd over PGlite: until it is over they say only its city, with no
 * street, building, map link or neighborhood (core's catalog.ts,
 * `publicVenue`). An evening over shows its venue again, and a public venue
 * is never touched. The catalog is written relative to now, since the
 * Worker reads the wall clock.
 */

const origin = "https://allthings.dev";

const ids = {
  hidden: "e0000000-0000-4000-8000-000000000801",
  over: "e0000000-0000-4000-8000-000000000802",
  open: "e0000000-0000-4000-8000-000000000803",
} as const;

/** `days` from now at 02:00 UTC, an evening in San Francisco. */
const evening = (days: number, hours = 0) => {
  const day = new Date(Date.now() + days * 86_400_000);
  const start = new Date(`${day.toISOString().slice(0, 10)}T02:00:00Z`);
  return `'${new Date(start.getTime() + hours * 3_600_000).toISOString()}'`;
};

const db = await migratedDatabase();
await db.exec(`
  INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, street_address, short_location, full_address, luma_event_id, is_hackathon, is_draft, venue_guests_only, updated_at) VALUES
    -- Ahead, its venue kept to guests: at a venue with a neighborhood (East Cut).
    ('${ids.hidden}', 'guests-only-evening', 'Guests Only Evening', 'Soon', ${evening(2)}, ${evening(2, 3)}, 200, '201 Spear St', '201 Spear St', '201 Spear St, San Francisco, CA 94105, USA', 'evt-hidden', false, false, true, now()),
    -- Over, its venue kept to guests while it was ahead (FiDi).
    ('${ids.over}', 'was-guests-only', 'Was Guests Only', 'Before', '2025-03-01T02:00:00Z', '2025-03-01T05:00:00Z', 100, 'Sentry, 45 Fremont St, San Francisco, CA 94105, USA', 'Sentry', 'Sentry, 45 Fremont St, San Francisco, CA 94105, USA', 'evt-over', false, false, true, now()),
    -- Ahead, its venue public (Potrero Hill).
    ('${ids.open}', 'public-venue', 'Public Venue', 'Later', ${evening(5)}, ${evening(5, 3)}, 100, NULL, 'Convex HQ', '444 De Haro St #218, San Francisco, CA 94107, USA', 'evt-open', false, false, false, now());
  INSERT INTO event_slugs (slug, event_id) VALUES
    ('hidden', '${ids.hidden}'), ('over', '${ids.over}'), ('open', '${ids.open}');
  UPDATE events e SET short_slug = l.slug
    FROM event_slugs l WHERE l.event_id = e.id;
`);
const database = await serve(db);

const Stack = testStack("allthings-web-guests-only-venue-test", {
  Venues: { ORIGIN: origin, DATABASE_URL: database.url },
});

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});
const workers = beforeAll(deploy(Stack));
afterAll(
  destroy(Stack).pipe(Effect.ensuring(Effect.promise(() => database.stop()))),
);

/** A test that gets the running Worker's URL. */
const it = (name: string, run: (url: string) => Promise<void>) =>
  test(
    name,
    Effect.flatMap(workers, (outputs) =>
      Effect.promise(() => {
        const value = outputs["Venues"];
        if (
          typeof value !== "string" ||
          !value.startsWith("http://localhost")
        ) {
          throw new Error(`Venues is not running locally: ${String(value)}`);
        }
        return run(value);
      }),
    ),
  );

/** The body of `path`, which must answer 200. */
const text = async (url: string, path: string) => {
  const response = await fetch(`${url}${path}`);
  expect(response.status).toBe(200);
  return response.text();
};

/** A tool's structured answer from the Worker's MCP server. */
const tool = async (url: string, name: string, args: object) => {
  const response = await fetch(
    mcpRequest(`${url}/mcp`, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  );
  const message = rpcMessage(await response.text()) as {
    result: { structuredContent: Record<string, unknown> };
  };
  return message.result.structuredContent;
};

/** The row labelled `label` on an event page, or "" when it has none. */
const row = (html: string, label: string) => {
  const start = html.indexOf(`<dt class="at-type-meta">${label}</dt>`);
  return start === -1 ? "" : html.slice(start, html.indexOf("</dd>", start));
};

/** The page's schema.org Event. */
const structuredData = (html: string) => {
  const match = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(
    html,
  );
  const data = JSON.parse(match?.[1] ?? "null") as
    | { "@type": string; location?: unknown }
    | ReadonlyArray<{ "@type": string; location?: unknown }>;
  return (Array.isArray(data) ? data : [data]).find(
    (item) => item["@type"] === "Event",
  );
};

/** What gives the hidden venue away: its street, and its neighborhood. */
const givesItAway = /201 Spear|East Cut/;

describe("an evening ahead whose venue Luma keeps to guests", () => {
  it("names only its city on its page: no address, map link or neighborhood", async (url) => {
    const html = await text(url, "/hidden");
    expect(html).not.toMatch(givesItAway);
    const where = row(html, "Where");
    expect(where).toContain('<p class="fact-head">San Francisco</p>');
    expect(where).not.toContain("google.com/maps");
    expect(where).not.toContain("neighborhood");
    expect(structuredData(html)?.location).toEqual({
      "@type": "Place",
      name: "San Francisco",
    });
  });

  it("puts only its city in the calendar file", async (url) => {
    const ics = await text(url, calendarPath("hidden"));
    expect(ics).toContain("LOCATION:San Francisco\r\n");
    expect(ics).not.toMatch(givesItAway);
  });

  it("is listed without a neighborhood on home and /events", async (url) => {
    for (const path of ["/", "/events"]) {
      const html = await text(url, path);
      expect(html).not.toMatch(givesItAway);
      expect(html.toLowerCase()).toContain("guests only evening");
      // The public venue's neighborhood still shows.
      expect(html).toContain("Potrero Hill");
    }
  });

  it("has only its city in the v1 API", async (url) => {
    const list = await text(url, "/api/v1/events");
    expect(list).not.toMatch(givesItAway);
    const { events } = JSON.parse(list) as {
      events: ReadonlyArray<Record<string, unknown>>;
    };
    const venue = (id: string) => {
      const event = events.find((item) => item["id"] === id);
      return {
        streetAddress: event?.["streetAddress"],
        shortLocation: event?.["shortLocation"],
        fullAddress: event?.["fullAddress"],
      };
    };
    expect(venue(ids.hidden)).toEqual({
      streetAddress: null,
      shortLocation: "San Francisco",
      fullAddress: null,
    });
    expect(venue(ids.open)).toEqual({
      streetAddress: null,
      shortLocation: "Convex HQ",
      fullAddress: "444 De Haro St #218, San Francisco, CA 94107, USA",
    });
    const one = await text(url, `/api/v1/events/${ids.hidden}`);
    expect(one).not.toMatch(givesItAway);
    expect(
      (JSON.parse(one) as { event: Record<string, unknown> }).event,
    ).toMatchObject({
      streetAddress: null,
      shortLocation: "San Francisco",
      fullAddress: null,
    });
  });

  it("has only its city in the MCP tools, and so the CLI", async (url) => {
    const { events } = (await tool(url, "list_events", { when: "all" })) as {
      events: ReadonlyArray<{ slug: string; venue: unknown }>;
    };
    expect(JSON.stringify(events)).not.toMatch(givesItAway);
    expect(
      events.find((event) => event.slug === "guests-only-evening")?.venue,
    ).toEqual({ name: "San Francisco", address: null });
    const event = await tool(url, "get_event", { slug: "hidden" });
    expect(JSON.stringify(event)).not.toMatch(givesItAway);
    expect(event["venue"]).toEqual({ name: "San Francisco", address: null });
  });

  it("never reaches the feeds", async (url) => {
    for (const path of ["/rss.xml", "/sitemap.xml"]) {
      expect(await text(url, path)).not.toMatch(givesItAway);
    }
  });
});

describe("once an evening is over, or while its venue is public", () => {
  it("shows the whole venue, mapped, in its neighborhood", async (url) => {
    const over = row(await text(url, "/over"), "Where");
    expect(over).toContain('<p class="fact-head place">FiDi</p>');
    expect(over).toContain("45 Fremont St, San Francisco, CA 94105, USA");
    expect(over).toContain("google.com/maps");
    const open = row(await text(url, "/open"), "Where");
    expect(open).toContain('<p class="fact-head place">Potrero Hill</p>');
    expect(open).toContain("444 De Haro St #218");
    expect(open).toContain("google.com/maps");
  });
});
