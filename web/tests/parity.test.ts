import { afterAll, describe, expect, test } from "bun:test";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { About } from "allthings-core/src/about.ts";
import type * as Contract from "allthings-core/src/contract.ts";
import { Evenings, type EveningsView } from "allthings-core/src/evenings.ts";
import { EventPages } from "allthings-core/src/event-page.ts";
import { Home, type HomeView } from "allthings-core/src/home.ts";
import {
  PeopleDirectory,
  type PeopleView,
  type PersonLookup,
} from "allthings-core/src/people-directory.ts";
import {
  clockAt,
  now,
  seededDatabase,
  sqlLayer,
} from "allthings-core/tests/support/database.ts";
import { ConfigProvider, DateTime, Effect, Layer } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import { Mcp, mcpRoute } from "../src/mcp/endpoint.ts";
import { FeedData } from "../src/seo/data.ts";
import { Site } from "../src/site.ts";
import { v1Routes } from "../src/v1/routes.ts";
import { mcpRequest, rpcMessage } from "./support/http.ts";

/**
 * The Worker's surfaces held to each other: the MCP tools (which the CLI
 * and the Claude plugin call), the v1 API, the feeds and the pages' read
 * models, over one seeded database at one instant. Each says which
 * evenings and people there are, in what order, and what an evening's
 * lineup is; they must all say the same (core/README.md, "One catalog").
 *
 * The MCP tools and the v1 API are served by their real routes, in this
 * process, reading the database over TCP as the Worker reads Hyperdrive;
 * the pages' models are read with core's services. Evenings and people are
 * compared by id, since the API and the pages name an evening by different
 * slugs.
 *
 * A disagreement found when this test was written was a `test.failing`,
 * with the decision that resolved it; each is settled now, and the
 * surfaces agree on all of it.
 */

const origin = "https://allthings.dev";
const photoOrigin = "https://storage.example";

const mastra = "c0000000-0000-4000-8000-000000000900";
const reactAtAcme = "e0000000-0000-4000-8000-000000000001";
const sharedPast = "e0000000-0000-4000-8000-000000000301";
const sharedSoon = "e0000000-0000-4000-8000-000000000302";

/**
 * tests/seed.sql, plus what tells the surfaces apart: Mastra's evenings we
 * share (one over, with its own speaker; one ahead, before our next), a
 * short link for React at Acme and a link it had before, a running order
 * that is not the attach order, and evenings' organizers, co-hosts and MC.
 */
const db = await seededDatabase();
await db.exec(`
  INSERT INTO sponsors (id, name, about, website_url, twitter_handle, updated_at) VALUES
    ('${mastra}', 'Mastra', 'Agents in TypeScript.', 'https://mastra.ai', 'mastra', now());
  INSERT INTO events (id, slug, name, tagline, start_date, end_date, attendee_limit, street_address, short_location, full_address, luma_event_id, is_hackathon, is_draft, preview_image, recording_url, updated_at) VALUES
    ('${sharedPast}', '2026-09-10-mastra-agents', 'Mastra agents night', 'Agents', '2026-09-11T01:00:00Z', '2026-09-11T04:00:00Z', 60, NULL, 'Mastra', NULL, 'evt-mastra', false, false, NULL, NULL, now()),
    ('${sharedSoon}', '2026-10-20-mastra-demo-day', 'Mastra demo day', 'Demos', '2026-10-21T01:00:00Z', '2026-10-21T04:00:00Z', 60, NULL, 'Mastra', NULL, 'evt-mastra-demo', false, false, NULL, NULL, now());
  UPDATE events SET curation = 'shared', organized_by = '${mastra}'
    WHERE id IN ('${sharedPast}', '${sharedSoon}');
  INSERT INTO event_sponsors (event_id, sponsor_id, created_at, updated_at) VALUES
    ('${sharedPast}', '${mastra}', '2026-01-03T00:00:03Z', now());

  INSERT INTO profiles (id, name, title, image, bio, profile_type, updated_at) VALUES
    ('b0000000-0000-4000-8000-000000000301', 'Sam Shared', 'Founder', NULL, 'Builds agents.', 'member', now()),
    ('b0000000-0000-4000-8000-000000000302', 'Olga Organizer', 'Organizer', NULL, '', 'organizer', now()),
    ('b0000000-0000-4000-8000-000000000303', 'Mia MC', '', NULL, '', 'member', now());
  INSERT INTO talks (id, title, description, updated_at) VALUES
    ('a0000000-0000-4000-8000-000000000301', 'Agents in production', '<p>Agents.</p>', now()),
    -- Linus gave another talk with the same title at Café night: talks are
    -- told apart by id, never by title.
    ('a0000000-0000-4000-8000-000000000302', 'Effect in production', '<p>Again.</p>', now());
  INSERT INTO talk_speakers (talk_id, speaker_id, created_at, updated_at) VALUES
    ('a0000000-0000-4000-8000-000000000301', 'b0000000-0000-4000-8000-000000000301', '2026-01-01T00:00:09Z', now()),
    ('a0000000-0000-4000-8000-000000000302', 'b0000000-0000-4000-8000-000000000003', '2026-01-01T00:00:10Z', now());
  INSERT INTO event_talks (event_id, talk_id, created_at, updated_at) VALUES
    ('${sharedPast}', 'a0000000-0000-4000-8000-000000000301', '2026-01-02T00:00:09Z', now()),
    ('e0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000302', '2026-01-02T00:00:10Z', now());

  -- React at Acme runs Server components first, though Effect was attached first.
  UPDATE event_talks SET position = 0
    WHERE event_id = '${reactAtAcme}' AND talk_id = 'a0000000-0000-4000-8000-000000000001';
  UPDATE event_talks SET position = 1
    WHERE event_id = '${reactAtAcme}' AND talk_id = 'a0000000-0000-4000-8000-000000000002';

  INSERT INTO event_slugs (slug, event_id) VALUES
    ('react-at-acme', '${reactAtAcme}'),
    ('react', '${reactAtAcme}');
  UPDATE events SET short_slug = 'react' WHERE id = '${reactAtAcme}';

  INSERT INTO event_people (event_id, profile_id, role, position, source, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000302', 'organizer', 0, 'site', now()),
    ('${reactAtAcme}', 'b0000000-0000-4000-8000-000000000003', 'co-host', 0, 'luma', now()),
    ('e0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000303', 'mc', 0, 'site', now());
`);

const postgres = new PGLiteSocketServer({ db, port: 0, maxConnections: 8 });
await postgres.start();
const databaseUrl = `postgres://postgres:postgres@${postgres.getServerConn()}/postgres`;
afterAll(async () => {
  await postgres.stop();
  await db.close();
});

interface EventRecord {
  readonly id: string;
  readonly slug: string;
  readonly short_slug: string | null;
  readonly is_draft: boolean;
  readonly start_date: Date;
}

const { rows: events } = await db.query<EventRecord>(
  "SELECT id, slug, short_slug, is_draft, start_date FROM events ORDER BY id",
);
const { rows: oldLinks } = await db.query<{ slug: string; event_id: string }>(
  `SELECT es.slug, es.event_id FROM event_slugs es
   JOIN events e ON e.id = es.event_id
   WHERE es.slug IS DISTINCT FROM e.short_slug ORDER BY es.slug`,
);
const { rows: profiles } = await db.query<{ name: string; slug: string }>(
  "SELECT name, slug FROM profiles ORDER BY id",
);

/** The evening a slug names: its long slug or its short link. */
function idOf(slug: string): string {
  // A short link wins over a long slug, as on the site (src/slugs.ts);
  // a link an evening had before still names it.
  const id =
    events.find((e) => e.short_slug === slug)?.id ??
    events.find((e) => e.slug === slug)?.id ??
    oldLinks.find((link) => link.slug === slug)?.event_id;
  if (id === undefined) throw new Error(`no evening at ${slug}`);
  return id;
}

const ids = (list: ReadonlyArray<{ readonly slug: string }>) =>
  list.map((item) => idOf(item.slug));

const slugOfPerson = (name: string): string => {
  const profile = profiles.find((p) => p.name === name);
  if (profile === undefined) throw new Error(`no profile named ${name}`);
  return profile.slug;
};

interface ToolResult {
  readonly isError?: boolean;
  readonly structuredContent?: unknown;
  readonly content?: ReadonlyArray<{ readonly text: string }>;
}

interface Summary {
  readonly slug: string;
  readonly status: Contract.EventStatus;
  readonly curation: "ours" | "shared";
  readonly organizer: { readonly name: string } | null;
}

interface McpEvent extends Summary {
  readonly talks: ReadonlyArray<{
    readonly title: string;
    readonly speakers: ReadonlyArray<{ readonly name: string }>;
  }>;
  readonly hosts: ReadonlyArray<{ readonly name: string }>;
}

interface McpSpeaker {
  readonly name: string;
  readonly talks: ReadonlyArray<{
    readonly title: string;
    readonly eventSlug: string;
  }>;
}

interface RestEvent {
  readonly id: string;
  readonly talks: ReadonlyArray<{
    readonly title: string;
    readonly speakers: ReadonlyArray<{ readonly name: string }>;
  }>;
  readonly hosts: ReadonlyArray<{ readonly name: string }>;
}

interface RestSpeaker {
  readonly id: string;
  readonly name: string;
  readonly talkIds: ReadonlyArray<string>;
}

/** Every surface, as of `at`. */
function surfacesAt(at: DateTime.Utc) {
  const clock = clockAt(at);
  const env = { ORIGIN: origin, DATABASE_URL: databaseUrl };
  const services = Layer.mergeAll(
    Site.layer,
    Mcp.layer.pipe(Layer.provide(Site.layer)),
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ConfigProvider.layer(ConfigProvider.fromUnknown(env)),
        clock,
      ),
    ),
  );
  const { handler } = HttpRouter.toWebHandler(
    Layer.mergeAll(v1Routes, mcpRoute).pipe(Layer.provideMerge(services)),
    { disableLogger: true },
  );

  let id = 0;
  const tool = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> => {
    id += 1;
    const response = await handler(
      mcpRequest(`${origin}/mcp`, {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    );
    const message = rpcMessage(await response.text()) as {
      readonly result?: ToolResult;
    };
    if (message.result === undefined) {
      throw new Error(`${name} answered ${JSON.stringify(message)}`);
    }
    return message.result;
  };

  const models = Layer.mergeAll(
    About.layer,
    Evenings.layer,
    EventPages.layer,
    FeedData.layer,
    Home.layer,
    PeopleDirectory.layer,
  ).pipe(Layer.provideMerge(sqlLayer(db)), Layer.provideMerge(clock));

  return {
    listEvents: async (when: "upcoming" | "past" | "all") =>
      (
        (await tool("list_events", { when, limit: 100 })).structuredContent as {
          readonly events: ReadonlyArray<Summary>;
        }
      ).events,
    getEvent: async (slug: string): Promise<McpEvent | undefined> => {
      const result = await tool("get_event", { slug });
      return result.isError === true
        ? undefined
        : (result.structuredContent as McpEvent);
    },
    listSpeakers: async () =>
      (
        (await tool("list_speakers", { limit: 200 })).structuredContent as {
          readonly speakers: ReadonlyArray<McpSpeaker>;
        }
      ).speakers,
    rest: async <A>(path: string): Promise<A | undefined> => {
      const response = await handler(new Request(`${origin}${path}`));
      if (response.status === 404) return undefined;
      expect(response.status).toBe(200);
      return (await response.json()) as A;
    },
    read: <A, E>(
      program: Effect.Effect<
        A,
        E,
        About | Evenings | EventPages | FeedData | Home | PeopleDirectory
      >,
    ): Promise<A> => Effect.runPromise(Effect.provide(program, models)),
  };
}

const surfaces = surfacesAt(now);

const evenings = (): Promise<EveningsView> =>
  surfaces.read(Evenings.use((repository) => repository.read));

const home = (s = surfaces): Promise<HomeView> =>
  s.read(Home.use((repository) => repository.read(photoOrigin)));

const eventPage = (slug: string, s = surfaces) =>
  s.read(
    EventPages.use((pages) => pages.read(slug, photoOrigin)).pipe(
      Effect.catchTag("EventNotFound", () => Effect.succeed(undefined)),
    ),
  );

const people = (): Promise<PeopleView> =>
  surfaces.read(
    PeopleDirectory.use((repository) => repository.read([], photoOrigin)),
  );

const person = (slug: string): Promise<PersonLookup> =>
  surfaces.read(
    PeopleDirectory.use((repository) => repository.person(slug, photoOrigin)),
  );

/** An evening's lineup as one surface states it: titles, speakers, hosts. */
const lineup = (event: {
  readonly talks: ReadonlyArray<{
    readonly title: string;
    readonly speakers: ReadonlyArray<{ readonly name: string }>;
  }>;
  readonly hosts: ReadonlyArray<string | { readonly name: string }>;
}) => ({
  talks: event.talks.map((talk) => ({
    title: talk.title,
    speakers: talk.speakers.map((speaker) => speaker.name),
  })),
  hosts: event.hosts.map((host) =>
    typeof host === "string" ? host : host.name,
  ),
});

describe("which evenings there are, and in what order", () => {
  test("list_events, /api/v1/events and the feed list the same evenings, latest first", async () => {
    const mcp = ids(await surfaces.listEvents("all"));
    const rest = (
      await surfaces.rest<{ readonly events: ReadonlyArray<{ id: string }> }>(
        "/api/v1/events",
      )
    )?.events.map((event) => event.id);
    const feed = ids(
      await surfaces.read(FeedData.use((data) => data.listPublished)),
    );
    // Every published evening and no draft, the latest start first (ids
    // break ties).
    expect(mcp).toEqual(
      events
        .filter((event) => !event.is_draft)
        .toSorted(
          (a, b) =>
            b.start_date.getTime() - a.start_date.getTime() ||
            a.id.localeCompare(b.id),
        )
        .map((event) => event.id),
    );
    expect(rest).toEqual(mcp);
    expect(feed).toEqual(mcp);
  });

  test("list_events' upcoming and past are /events' ahead and past, in order", async () => {
    const view = await evenings();
    expect(ids(await surfaces.listEvents("upcoming"))).toEqual(ids(view.ahead));
    expect(ids(await surfaces.listEvents("past"))).toEqual(ids(view.past));
    expect(new Set([...ids(view.ahead), ...ids(view.past)])).toEqual(
      new Set(ids(await surfaces.listEvents("all"))),
    );
  });

  test("list_events says whose each evening is, as /events does", async () => {
    const view = await evenings();
    const pages = new Map(
      [...view.ahead, ...view.past].map((e) => [
        idOf(e.slug),
        e.curation.kind === "shared"
          ? { curation: "shared", organizer: e.curation.organizer.name }
          : { curation: "ours", organizer: null },
      ]),
    );
    const listed = await surfaces.listEvents("all");
    expect(listed.filter((e) => e.curation === "shared").length).toBe(2);
    for (const event of listed) {
      const id = idOf(event.slug);
      expect({ id, ...pages.get(id) }).toEqual({
        id,
        curation: event.curation,
        organizer: event.organizer?.name ?? null,
      });
    }
  });

  test("every surface gives an evening the same status", async () => {
    const view = await evenings();
    const pages = new Map(
      [...view.ahead, ...view.past].map((e) => [idOf(e.slug), e.status]),
    );
    for (const event of await surfaces.listEvents("all")) {
      const id = idOf(event.slug);
      expect({ id, status: pages.get(id) }).toEqual({
        id,
        status: event.status,
      });
    }
  });

  test("every surface reads the evenings as of the same minute", async () => {
    // Half a minute after Ends now is over, every surface reads as of
    // 19:00, its last instant, when it is live, and credits no talk of it.
    const halfMinute = surfacesAt(DateTime.makeUnsafe("2026-10-03T19:00:30Z"));
    const view = await halfMinute.read(
      Evenings.use((repository) => repository.read),
    );
    const pages = new Map(
      [...view.ahead, ...view.past].map((e) => [idOf(e.slug), e.status]),
    );
    expect(pages.get("e0000000-0000-4000-8000-000000000005")).toBe("live");
    for (const event of await halfMinute.listEvents("all")) {
      const id = idOf(event.slug);
      expect({ id, status: pages.get(id) }).toEqual({
        id,
        status: event.status,
      });
    }
    const credited = (await halfMinute.listSpeakers()).flatMap((speaker) =>
      speaker.talks.map((talk) => talk.eventSlug),
    );
    expect(credited.length).toBeGreaterThan(0);
    expect(credited).not.toContain("2026-10-03-ends-now");
  });

  test("home leads with our next evening and lists the rest as /events orders them", async () => {
    const view = await evenings();
    const page = await home();
    const ours = view.ahead.find((evening) => evening.curation.kind === "ours");
    expect(page.next?.slug).toBe(ours?.slug);
    expect(ids(page.afterThat)).toEqual(
      ids(view.ahead.filter((e) => e.slug !== ours?.slug)).slice(
        0,
        page.afterThat.length,
      ),
    );
    expect(page.afterThat.length).toBeGreaterThan(0);
    expect(ids(page.recently)).toEqual(
      ids(view.past).slice(0, page.recently.length),
    );
    expect(page.recently.length).toBeGreaterThan(0);
  });

  test("/about counts the evenings /events lists as over and ours", async () => {
    const view = await evenings();
    const about = await surfaces.read(
      About.use((repository) => repository.read([], photoOrigin)),
    );
    expect(about.evenings).toBe(
      view.past.filter((e) => e.curation.kind === "ours").length,
    );
  });
});

describe("one evening, wherever it is asked for", () => {
  const published = events.filter((event) => !event.is_draft);
  const links = [
    ...published.flatMap((event) => [
      event.slug,
      ...(event.short_slug === null ? [] : [event.short_slug]),
    ]),
    ...oldLinks.map((link) => link.slug),
  ];
  if (oldLinks.length === 0) throw new Error("the fixture has no old link");

  test.each(links)(
    "get_event, /api/v1/events/:id and the page agree on %s",
    async (slug) => {
      // Each surface is asked on its own, so one that fails doesn't hide
      // what the others say.
      const id = idOf(slug);
      const mcp = await surfaces.getEvent(slug);
      const page = await eventPage(slug);
      const rest = (
        await surfaces.rest<{ readonly event: RestEvent }>(
          `/api/v1/events/${id}`,
        )
      )?.event;
      expect(page?.id).toBe(id);
      expect(mcp === undefined ? undefined : idOf(mcp.slug)).toBe(id);
      expect(rest?.id).toBe(id);
      const expected = page === undefined ? undefined : lineup(page);
      expect(mcp === undefined ? undefined : lineup(mcp)).toEqual(expected);
      expect(rest === undefined ? undefined : lineup(rest)).toEqual(expected);
    },
  );

  test("React at Acme runs in its running order on every surface", async () => {
    const order = ["Server components", "Effect in production"];
    const titles = (
      event:
        | { readonly talks: ReadonlyArray<{ readonly title: string }> }
        | undefined,
    ) => event?.talks.map((talk) => talk.title);
    expect(titles(await surfaces.getEvent("react"))).toEqual(order);
    expect(titles(await eventPage("react"))).toEqual(order);
    expect(
      titles(
        (
          await surfaces.rest<{ readonly event: RestEvent }>(
            `/api/v1/events/${reactAtAcme}`,
          )
        )?.event,
      ),
    ).toEqual(order);
  });

  test.each(events.filter((event) => event.is_draft).map((e) => e.slug))(
    "a draft is found nowhere: %s",
    async (slug) => {
      const draft = events.find((event) => event.slug === slug);
      expect(await surfaces.getEvent(slug)).toBeUndefined();
      expect(await eventPage(slug)).toBeUndefined();
      expect(
        await surfaces.rest(`/api/v1/events/${draft?.id ?? ""}`),
      ).toBeUndefined();
    },
  );
});

describe("what comes next", () => {
  test("an evening that is over points to the evening home leads with", async () => {
    const page = await eventPage("react");
    expect(page?.next?.slug).toBe((await home()).next?.slug);
  });

  // On 10 October, Mastra's demo day is the soonest evening, and ours on
  // 5 November is the next.
  const later = surfacesAt(DateTime.makeUnsafe("2026-10-10T00:00:00Z"));

  test("home leads with ours when an evening we only share is the soonest", async () => {
    const view = await later.read(
      Evenings.use((repository) => repository.read),
    );
    expect(view.ahead[0]?.slug).toBe("2026-10-20-mastra-demo-day");
    expect((await home(later)).next?.slug).toBe("2026-11-05-upcoming");
  });

  // An evening's page points to our next evening, as home leads with it,
  // never to one we only share.
  test("an evening's page does too", async () => {
    const page = await eventPage("react", later);
    expect(page?.next?.slug).toBe("2026-11-05-upcoming");
  });
});

describe("who has been on stage", () => {
  test("list_speakers and /api/v1/speakers list the same people with the same talks", async () => {
    const mcp = await surfaces.listSpeakers();
    const rest =
      (
        await surfaces.rest<{ readonly speakers: ReadonlyArray<RestSpeaker> }>(
          "/api/v1/speakers",
        )
      )?.speakers ?? [];
    // list_speakers names each talk by its title at an evening; the API
    // lists each talk once, by id. The talk a title names at an evening is
    // found by the speaker too, since one speaker may give two talks with
    // one title.
    const { rows: given } = await db.query<{
      talk_id: string;
      event_id: string;
      title: string;
      name: string;
    }>(
      `SELECT t.id AS talk_id, et.event_id, t.title, p.name
       FROM talks t
       JOIN event_talks et ON et.talk_id = t.id
       JOIN talk_speakers ts ON ts.talk_id = t.id
       JOIN profiles p ON p.id = ts.speaker_id`,
    );
    const talkId = (name: string, title: string, eventId: string): string => {
      const row = given.find(
        (r) => r.name === name && r.title === title && r.event_id === eventId,
      );
      if (row === undefined) throw new Error(`${name} gave no ${title}`);
      return row.talk_id;
    };
    expect(mcp.length).toBeGreaterThan(0);
    expect(rest.map((s) => s.name)).toEqual(mcp.map((s) => s.name));
    for (const [i, speaker] of mcp.entries()) {
      expect(rest[i]?.talkIds).toEqual([
        ...new Set(
          speaker.talks.map((talk) =>
            talkId(speaker.name, talk.title, idOf(talk.eventSlug)),
          ),
        ),
      ]);
    }
    // Linus's two talks called Effect in production are two talks.
    const linus = rest.find((speaker) => speaker.name === "Linus");
    expect(linus?.talkIds).toHaveLength(3);
  });

  test("a person's page lists every talk list_speakers credits them with", async () => {
    for (const speaker of await surfaces.listSpeakers()) {
      const found = await person(slugOfPerson(speaker.name));
      expect(found.kind).toBe("found");
      if (found.kind !== "found") continue;
      const given = found.person.parts.flatMap((part) =>
        part.kind === "talk"
          ? [`${part.title} @ ${idOf(part.evening.slug)}`]
          : [],
      );
      for (const talk of speaker.talks) {
        expect(given).toContain(`${talk.title} @ ${idOf(talk.eventSlug)}`);
      }
    }
  });

  test("the sitemap lists a page for everyone /people and list_speakers name", async () => {
    const listed = new Set(
      (await surfaces.read(FeedData.use((data) => data.listPeople))).map(
        (p) => p.slug,
      ),
    );
    const view = await people();
    for (const p of [...view.organizers, ...view.speakers, ...view.coHosts]) {
      expect(listed).toContain(p.slug);
    }
    for (const speaker of await surfaces.listSpeakers()) {
      expect(listed).toContain(slugOfPerson(speaker.name));
    }
  });

  // A talk has been given once its evening is over, by the rule that says
  // it is (eventStatus: live through its end): not at Ends now's last
  // instant, while it is still live.
  test("list_speakers credits a talk only once its evening is over", async () => {
    const statusOf = new Map(
      (await surfaces.listEvents("all")).map((e) => [idOf(e.slug), e.status]),
    );
    for (const speaker of await surfaces.listSpeakers()) {
      for (const talk of speaker.talks) {
        expect([talk.eventSlug, statusOf.get(idOf(talk.eventSlug))]).toEqual([
          talk.eventSlug,
          "past",
        ]);
      }
    }
  });

  // allthings speakers are those of our evenings, as /people lists them:
  // never Mastra's speaker, whose evening we only share.
  test("everyone list_speakers lists is on /people with those talks", async () => {
    const view = await people();
    const onPeople = new Map(
      [...view.organizers, ...view.speakers, ...view.coHosts].map((p) => [
        p.name,
        p,
      ]),
    );
    for (const speaker of await surfaces.listSpeakers()) {
      const listed = onPeople.get(speaker.name);
      expect(listed?.name).toBe(speaker.name);
      const given = (listed?.parts ?? []).flatMap((part) =>
        part.kind === "talk"
          ? [`${part.title} @ ${idOf(part.evening.slug)}`]
          : [],
      );
      for (const talk of speaker.talks) {
        expect(given).toContain(`${talk.title} @ ${idOf(talk.eventSlug)}`);
      }
    }
  });

  // /about counts the speakers of our evenings that are over, which
  // list_speakers lists.
  test("/about counts the speakers list_speakers lists", async () => {
    const about = await surfaces.read(
      About.use((repository) => repository.read([], photoOrigin)),
    );
    expect(about.speakers).toBe((await surfaces.listSpeakers()).length);
  });
});
