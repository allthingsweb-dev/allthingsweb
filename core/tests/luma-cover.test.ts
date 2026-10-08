import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Cause, DateTime, Effect, Exit, Layer } from "effect";
import { approvalToken } from "../src/approval.ts";
import {
  type CoverFacts,
  coverFacts,
  CoverRenderer,
  hostNames,
  isLumaDefaultCover,
  sha256,
} from "../src/cover.ts";
import { EventPages } from "../src/event-page.ts";
import { Covers } from "../src/luma/cover.ts";
import { LumaWrite, type ManagedEvent } from "../src/luma/write.ts";
import { ShortSlugs } from "../src/slugs.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";
import { configFrom, fakeLumaBy, type Reply, settle } from "./support/luma.ts";

/**
 * An evening's Luma cover (src/cover.ts, src/luma/cover.ts): what it says,
 * and setting exactly the approved one, against a fake Luma that answers as
 * docs.luma.com documents and a renderer that stands in for
 * brand/marks/cover.py. Nothing here reaches Luma or runs uv.
 */

const key = "test-luma-key";
const draft = "2026-09-01-draft-night";
const gallery =
  "https://images.lumacdn.com/gallery-images/kd/12b33577-492a-4ae2-af6f-f7cd814d862c";

/** The seed's draft with a date ahead, a place in East Cut, a host and a topic. */
const ready = `
  UPDATE events SET start_date = '2026-11-18T02:00:00Z', end_date = '2026-11-18T05:00:00Z',
    street_address = '201 Spear St', full_address = '201 Spear St, San Francisco, CA 94105',
    short_location = 'CodeRabbit', preview_image = 'd0000000-0000-4000-8000-000000000001', topic = 'drafts'
    WHERE slug = '${draft}';
  INSERT INTO event_sponsors (event_id, sponsor_id, created_at, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', now(), now());
`;

const lumaEvent = (overrides: Partial<ManagedEvent> = {}): ManagedEvent => ({
  id: "evt-draft",
  access: "manage",
  name: "Draft night",
  start_at: "2026-11-18T02:00:00.000Z",
  end_at: "2026-11-18T05:00:00.000Z",
  timezone: "America/Los_Angeles",
  url: "https://luma.com/draft-night",
  visibility: "private",
  cover_url: gallery,
  ...overrides,
});

const json = (value: unknown): Reply => ({ body: JSON.stringify(value) });

/** What the stand-in renderer draws: the facts' text, so different facts draw differently. */
const drawn = (facts: CoverFacts) =>
  new TextEncoder().encode(`PNG ${JSON.stringify(facts)}`);

let db: PGlite;
let rendered: Array<CoverFacts>;
beforeEach(async () => {
  db = await seededDatabase();
  await db.exec(ready);
  rendered = [];
});
afterEach(() => db.close());

const run = async <A, E>(
  f: (covers: Covers["Service"]) => Effect.Effect<A, E>,
  replies: Record<string, ReadonlyArray<Reply>>,
) => {
  const luma = fakeLumaBy((url) => url.pathname, replies);
  const renderer = Layer.succeed(
    CoverRenderer,
    CoverRenderer.of({
      render: (facts) =>
        Effect.sync(() => {
          rendered.push(facts);
          return drawn(facts);
        }),
    }),
  );
  const layer = Covers.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        LumaWrite.layer.pipe(
          Layer.provide(
            Layer.mergeAll(luma.layer, configFrom({ LUMA_API_KEY: key })),
          ),
        ),
        EventPages.layer,
        ShortSlugs.layer,
        renderer,
      ),
    ),
    Layer.provideMerge(sqlLayer(db)),
    Layer.provideMerge(clockLayer),
  );
  const exit = await Effect.runPromiseExit(
    settle(Covers.use(f)).pipe(Effect.provide(layer)),
  );
  return { exit, requests: luma.requests };
};

const message = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) throw new Error("expected a failure");
  const error = Cause.squash(exit.cause);
  return error instanceof Error ? error.message : String(error);
};

const value = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
  return exit.value;
};

const recorded = async () =>
  (
    await db.query<{
      generated_cover_url: string | null;
      generated_cover_sha256: string | null;
      generated_cover_facts: string | null;
      preview_image: string | null;
    }>(
      `SELECT generated_cover_url, generated_cover_sha256, generated_cover_facts, preview_image
       FROM events WHERE slug = $1`,
      [draft],
    )
  ).rows[0];

/** The draft's facts, as its cover says them. */
const draftFacts: CoverFacts = {
  mode: "night",
  topic: "drafts",
  name: "Draft night",
  ahead: true,
  date: "Tue Nov 17",
  time: "6:00 PM",
  year: "2026",
  neighborhood: "East Cut",
  hosts: "Acme",
  venue: "CodeRabbit",
  link: "allthings.dev/drafts",
};

describe("what a cover says", () => {
  const page = {
    mode: "night" as const,
    topic: "effect",
    name: "Effect San Francisco",
    status: "upcoming" as const,
    startsAt: DateTime.makeUnsafe("2026-10-01T00:30:00Z"),
    venue: {
      neighborhood: "East Cut",
      name: "CodeRabbit",
      address: "201 Spear St",
      mapQuery: "201 Spear St",
    },
    hosts: ["CodeRabbit"],
  };

  test("the lockup, San Francisco's day, hour and year, the place, the hosts and the link", () => {
    expect(coverFacts(page, "effect", "allthings.dev")).toEqual({
      mode: "night",
      topic: "effect",
      name: "Effect San Francisco",
      ahead: true,
      date: "Wed Sep 30",
      time: "5:30 PM",
      year: "2026",
      neighborhood: "East Cut",
      hosts: "CodeRabbit",
      venue: "CodeRabbit",
      link: "allthings.dev/effect",
    });
  });

  test("a past evening loses the cursor; one without a topic, a place or hosts says what it has", () => {
    expect(
      coverFacts(
        {
          ...page,
          topic: undefined,
          name: "Pre Next.js Conf / Ship AI Meetup",
          status: "past",
          startsAt: DateTime.makeUnsafe("2024-10-05T17:00:00Z"),
          mode: "paper",
          venue: null,
          hosts: [],
        },
        "ship-ai",
        "allthings.dev",
      ),
    ).toMatchObject({
      mode: "paper",
      topic: null,
      ahead: false,
      date: "Sat Oct 5",
      time: "10:00 AM",
      year: "2024",
      neighborhood: null,
      hosts: null,
      venue: null,
    });
  });

  test("hosts are named as every surface names them", () => {
    expect(hostNames([])).toBeNull();
    expect(hostNames(["Convex", "Discord"])).toBe("Convex & Discord");
    expect(hostNames(["Convex", "Discord", "Expo"])).toBe(
      "Convex, Discord & Expo",
    );
  });

  test("Luma's own covers are its gallery's", () => {
    expect(isLumaDefaultCover(gallery)).toBe(true);
    expect(
      isLumaDefaultCover(
        "https://images.lumacdn.com/gallery-images/6v/8eb55214.png",
      ),
    ).toBe(true);
    expect(
      isLumaDefaultCover(
        "https://images.lumacdn.com/event-covers/z7/3a8a1e03.jpg",
      ),
    ).toBe(false);
    expect(
      isLumaDefaultCover("https://images.lumacdn.com/api-uploads/3n/5366.jpg"),
    ).toBe(false);
    expect(isLumaDefaultCover("https://example.com/gallery-images/x.png")).toBe(
      false,
    );
    expect(isLumaDefaultCover(null)).toBe(false);
    expect(isLumaDefaultCover("not a url")).toBe(false);
  });
});

describe("prepare", () => {
  test("draws the draft's cover, with the link it gets when published, and says what it replaces", async () => {
    const { exit, requests } = await run(
      (c) => c.prepare({ _tag: "Slug", slug: draft }),
      {
        "/v1/events/get": [json(lumaEvent())],
      },
    );
    const prepared = value(exit);
    expect(prepared.facts).toEqual(draftFacts);
    expect(rendered).toEqual([draftFacts]);
    expect(prepared.current).toEqual({
      url: gallery,
      lumaDefault: true,
      ours: false,
    });
    expect(prepared.refused).toBeNull();
    const digest = await Effect.runPromise(sha256(drawn(draftFacts)));
    expect(prepared.sha256).toBe(digest);
    expect(prepared.factsToken).toBe(
      await Effect.runPromise(approvalToken(draftFacts)),
    );
    expect(prepared.token).toBe(
      await Effect.runPromise(
        approvalToken({
          lumaEventId: "evt-draft",
          facts: draftFacts,
          sha256: digest,
          replaces: gallery,
        }),
      ),
    );
    // Only read: nothing uploaded, nothing changed.
    expect(
      requests.map((r) => `${r.method} ${new URL(r.url).pathname}`),
    ).toEqual(["GET /v1/events/get"]);
    expect(await recorded()).toMatchObject({ generated_cover_url: null });
  });

  test("finds the evening by its Luma id too", async () => {
    const { exit } = await run(
      (c) => c.prepare({ _tag: "Luma", lumaEventId: "evt-draft" }),
      { "/v1/events/get": [json(lumaEvent())] },
    );
    expect(value(exit).slug).toBe(draft);
  });

  test("draws a published evening's cover, which approving would refuse", async () => {
    const { exit } = await run(
      (c) => c.prepare({ _tag: "Slug", slug: "2026-08-12-react-at-acme" }),
      {
        "/v1/events/get": [
          json(
            lumaEvent({
              id: "evt-react",
              name: "React at Acme",
              visibility: "public",
            }),
          ),
        ],
      },
    );
    const prepared = value(exit);
    expect(prepared.facts).toMatchObject({
      topic: "react",
      ahead: false,
      hosts: "Globex & Acme",
    });
    expect(prepared.refused).toBe(
      "React at Acme is public on Luma: what the public sees changes only through publish.",
    );
  });

  test("refuses a shared evening, and one without a Luma event", async () => {
    await db.exec(`
      UPDATE events SET curation = 'shared', organized_by = 'c0000000-0000-4000-8000-000000000002'
        WHERE id = 'e0000000-0000-4000-8000-000000000001';`);
    const shared = await run(
      (c) => c.prepare({ _tag: "Slug", slug: "2026-08-12-react-at-acme" }),
      {},
    );
    expect(message(shared.exit)).toBe(
      "2026-08-12-react-at-acme is shared: its Luma page, cover and all, is its organizer's.",
    );
    const noLuma = await run(
      (c) => c.prepare({ _tag: "Slug", slug: "2026-10-03-hack-day" }),
      {},
    );
    expect(message(noLuma.exit)).toBe(
      "2026-10-03-hack-day has no Luma event yet.",
    );
    const none = await run(
      (c) => c.prepare({ _tag: "Slug", slug: "no-such-evening" }),
      {},
    );
    expect(message(none.exit)).toBe(
      "No evening, published or draft, is no-such-evening.",
    );
    for (const { requests } of [shared, noLuma, none]) {
      expect(requests).toEqual([]);
    }
  });
});

describe("approve", () => {
  const tokenFor = async () =>
    value(
      (
        await run((c) => c.prepare({ _tag: "Slug", slug: draft }), {
          "/v1/events/get": [json(lumaEvent())],
        })
      ).exit,
    ).token;

  const uploaded = "https://images.lumacdn.com/api-uploads/ab/new-cover.png";

  test("uploads exactly the approved cover, sets it, checks it took and records it", async () => {
    const token = await tokenFor();
    const { exit, requests } = await run(
      (c) => c.approve({ _tag: "Slug", slug: draft }, token),
      {
        "/v1/events/get": [
          json(lumaEvent()),
          json(lumaEvent({ cover_url: uploaded })),
        ],
        "/v1/images/create-upload-url": [
          json({
            upload_url: "https://upload.example/put/abc",
            file_url: uploaded,
          }),
        ],
        "/put/abc": [{ status: 200 }],
        "/v1/events/update": [json({})],
      },
    );
    const set = value(exit);
    expect(set.coverUrl).toBe(uploaded);
    expect(
      requests.map(
        (r) => `${r.method} ${new URL(r.url).pathname} ${r.apiKey ?? "-"}`,
      ),
    ).toEqual([
      `GET /v1/events/get ${key}`,
      `POST /v1/images/create-upload-url ${key}`,
      // The upload URL is signed; the key never goes there.
      "PUT /put/abc -",
      `POST /v1/events/update ${key}`,
      `GET /v1/events/get ${key}`,
    ]);
    expect(JSON.parse(requests[1]?.body ?? "")).toEqual({
      content_type: "image/png",
    });
    expect(requests[2]?.body).toBe(new TextDecoder().decode(drawn(draftFacts)));
    expect(JSON.parse(requests[3]?.body ?? "")).toEqual({
      event_id: "evt-draft",
      cover_url: uploaded,
    });
    expect(await recorded()).toEqual({
      generated_cover_url: uploaded,
      generated_cover_sha256: set.sha256,
      generated_cover_facts: set.factsToken,
      // Let go, so the ingestion stores the new cover.
      preview_image: null,
    });

    // The next prepare sees the cover as ours.
    const again = await run((c) => c.prepare({ _tag: "Slug", slug: draft }), {
      "/v1/events/get": [json(lumaEvent({ cover_url: uploaded }))],
    });
    expect(value(again.exit).current).toEqual({
      url: uploaded,
      lumaDefault: false,
      ours: true,
    });
  });

  test("refuses a token for anything else: changed facts, or a changed cover on Luma", async () => {
    const token = await tokenFor();
    await db.exec(
      `UPDATE events SET start_date = '2026-11-19T02:00:00Z', end_date = '2026-11-19T05:00:00Z' WHERE slug = '${draft}'`,
    );
    const moved = await run(
      (c) => c.approve({ _tag: "Slug", slug: draft }, token),
      { "/v1/events/get": [json(lumaEvent())] },
    );
    expect(message(moved.exit)).toStartWith(
      `The cover, or what it would replace, has changed since ${token} was approved`,
    );
    await db.exec(
      `UPDATE events SET start_date = '2026-11-18T02:00:00Z', end_date = '2026-11-18T05:00:00Z' WHERE slug = '${draft}'`,
    );
    const replaced = await run(
      (c) => c.approve({ _tag: "Slug", slug: draft }, token),
      {
        "/v1/events/get": [
          json(lumaEvent({ cover_url: "https://images.lumacdn.com/x.png" })),
        ],
      },
    );
    expect(message(replaced.exit)).toStartWith("The cover, or what it would");
    for (const { requests } of [moved, replaced]) {
      expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
        "/v1/events/get",
      ]);
    }
    expect(await recorded()).toMatchObject({ generated_cover_url: null });
  });

  test("refuses a public event, whatever the token", async () => {
    const token = await tokenFor();
    const { exit, requests } = await run(
      (c) => c.approve({ _tag: "Slug", slug: draft }, token),
      { "/v1/events/get": [json(lumaEvent({ visibility: "public" }))] },
    );
    expect(message(exit)).toBe(
      "Draft night is public on Luma: what the public sees changes only through publish.",
    );
    expect(requests).toHaveLength(1);
  });

  test.each([
    ["the old one", gallery],
    ["another", "https://images.lumacdn.com/api-uploads/zz/someone-else.png"],
  ])(
    "records nothing when Luma shows %s, not the uploaded cover",
    async (_which, shown) => {
      const token = await tokenFor();
      const { exit } = await run(
        (c) => c.approve({ _tag: "Slug", slug: draft }, token),
        {
          "/v1/events/get": [
            json(lumaEvent()),
            json(lumaEvent({ cover_url: shown })),
          ],
          "/v1/images/create-upload-url": [
            json({
              upload_url: "https://upload.example/put/abc",
              file_url: uploaded,
            }),
          ],
          "/put/abc": [{ status: 200 }],
          "/v1/events/update": [json({})],
        },
      );
      expect(message(exit)).toBe(
        `Luma took the update but Draft night's cover is ${shown}, not the one uploaded (${uploaded}). Nothing was recorded.`,
      );
      expect(await recorded()).toMatchObject({
        generated_cover_url: null,
        preview_image: "d0000000-0000-4000-8000-000000000001",
      });
    },
  );
});
