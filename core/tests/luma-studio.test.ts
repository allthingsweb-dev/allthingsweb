import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Cause, Effect, Exit, Layer } from "effect";
import { approvalToken, canonicalJson } from "../src/approval.ts";
import { coverFactsOf } from "../src/cover.ts";
import { EventPages } from "../src/event-page.ts";
import { instant, outgoingOf, Studio } from "../src/luma/publish.ts";
import { LumaWrite, type ManagedEvent } from "../src/luma/write.ts";
import { Planning } from "../src/planning/planning.ts";
import { Promo } from "../src/promo/promo.ts";
import { Readiness } from "../src/readiness/readiness.ts";
import { ShortSlugs } from "../src/slugs.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";
import {
  configFrom,
  fakeLumaBy,
  fixture,
  type Reply,
  settle,
} from "./support/luma.ts";

/**
 * The event studio's Luma half (src/luma/publish.ts, write.ts) against a
 * fake Luma that answers as docs.luma.com documents and records every
 * request: nothing here reaches Luma. The draft is tests/seed.sql's,
 * filled in until readiness finds nothing blocking.
 */

const key = "test-luma-key";

/** The seed's draft, made ready: a date ahead, a venue, a host, an organizer, a cover. */
const ready = `
  UPDATE events SET start_date = '2026-11-18T02:00:00Z', end_date = '2026-11-18T05:00:00Z',
    street_address = '201 Spear St', full_address = '201 Spear St, San Francisco, CA 94105',
    short_location = 'CodeRabbit', preview_image = 'd0000000-0000-4000-8000-000000000001', topic = 'drafts'
    WHERE slug = '2026-09-01-draft-night';
  UPDATE profiles SET image = 'd0000000-0000-4000-8000-000000000005', twitter_handle = 'draftonly'
    WHERE id = 'b0000000-0000-4000-8000-000000000004';
  INSERT INTO event_sponsors (event_id, sponsor_id, created_at, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', now(), now());
  INSERT INTO event_people (event_id, profile_id, role, position, source, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'organizer', 0, 'site', now());
`;

const draft = "2026-09-01-draft-night";

const lumaEvent = (overrides: Partial<ManagedEvent> = {}): ManagedEvent => ({
  id: "evt-draft",
  access: "manage",
  name: "Draft night",
  start_at: "2026-11-18T02:00:00.000Z",
  end_at: "2026-11-18T05:00:00.000Z",
  timezone: "America/Los_Angeles",
  url: "https://luma.com/draft-night",
  visibility: "private",
  cover_url: "https://images.lumacdn.com/cover.png",
  description_md: "",
  geo_address_json: { full_address: "201 Spear St, San Francisco, CA 94105" },
  guest_counts: { approved: { guests: 0 } },
  ...overrides,
});

const json = (value: unknown): Reply => ({ body: JSON.stringify(value) });

let db: PGlite;
/** The cover `bun run luma cover` set and recorded, as Luma shows it (lumaEvent's). */
const ourCover = "https://images.lumacdn.com/cover.png";

/** Records our cover on the draft, drawn from its facts as they are now. */
const recordOurCover = async () => {
  const { token } = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* coverFactsOf(yield* EventPages, yield* ShortSlugs, {
        id: "e0000000-0000-4000-8000-000000000002",
        slug: draft,
        shortSlug: null,
        lumaEventId: "evt-draft",
        isDraft: true,
      });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(EventPages.layer, ShortSlugs.layer).pipe(
          Layer.provideMerge(sqlLayer(db)),
          Layer.provideMerge(clockLayer),
        ),
      ),
    ),
  );
  await db.exec(`UPDATE events SET generated_cover_url = '${ourCover}',
    generated_cover_sha256 = '${"a".repeat(64)}', generated_cover_facts = '${token}'
    WHERE slug = '${draft}'`);
};

beforeEach(async () => {
  db = await seededDatabase();
  await db.exec(ready);
  await recordOurCover();
});
afterEach(() => db.close());

/** Runs `f` with Luma answering each path from `replies`; what it was asked. */
const run = async <A, E>(
  f: (studio: Studio["Service"]) => Effect.Effect<A, E>,
  replies: Record<string, ReadonlyArray<Reply>>,
  env: Record<string, string> = { LUMA_API_KEY: key },
) => {
  const luma = fakeLumaBy((url) => url.pathname, replies);
  const layer = Studio.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        LumaWrite.layer.pipe(
          Layer.provide(Layer.mergeAll(luma.layer, configFrom(env))),
        ),
        Planning.layer,
        Promo.layer,
        Readiness.layer,
      ),
    ),
    Layer.provideMerge(sqlLayer(db)),
    Layer.provideMerge(clockLayer),
  );
  const exit = await Effect.runPromiseExit(
    settle(Studio.use(f)).pipe(Effect.provide(layer)),
  );
  return { exit, requests: luma.requests };
};

/** The draft's log, its commands and summaries, oldest first (src/planning/draft-log.ts). */
const logged = async () =>
  (
    await db.query<{ command: string; summary: string }>(
      `SELECT l.command, l.summary FROM planning.draft_log l
       JOIN events e ON e.id = l.event_id WHERE e.slug = '${draft}'
       ORDER BY l.at, l.command`,
    )
  ).rows;

const message = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) throw new Error("expected a failure");
  const error = Cause.squash(exit.cause);
  return error instanceof Error ? error.message : String(error);
};

const value = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
  return exit.value;
};

describe("pure parts", () => {
  test("instant takes a time with its offset, only", () => {
    expect(instant("2026-11-18T18:00:00-08:00")).toBe(
      "2026-11-19T02:00:00.000Z",
    );
    expect(instant("2026-11-18T18:00Z")).toBe("2026-11-18T18:00:00.000Z");
    expect(instant("2026-11-18T18:00:00")).toBeUndefined();
    expect(instant("Nov 18 6pm")).toBeUndefined();
  });

  test("the approval token is the content's, whatever the key order", async () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(
      '{"a":[{"c":3,"d":2}],"b":1}',
    );
    const outgoing = outgoingOf(lumaEvent(), "Hello");
    const token = await Effect.runPromise(approvalToken(outgoing));
    expect(token).toMatch(/^[0-9a-f]{16}$/);
    const reordered = Object.fromEntries(Object.entries(outgoing).toReversed());
    expect(
      await Effect.runPromise(approvalToken(reordered as typeof outgoing)),
    ).toBe(token);
    expect(
      await Effect.runPromise(
        approvalToken({ ...outgoing, descriptionMd: "Hello!" }),
      ),
    ).not.toBe(token);
  });
});

describe("create", () => {
  test("makes a private event in San Francisco's time zone, from the idea's pitch", async () => {
    const idea = await Effect.runPromise(
      Planning.use((p) =>
        p.addIdea({
          title: "Made-up quiz",
          pitch: "Rounds on everything.",
          program: "social",
        }),
      ).pipe(
        Effect.provide(
          Planning.layer.pipe(
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );
    const input = {
      name: "All Things Made Up",
      startAt: "2026-12-02T02:00:00.000Z",
      endAt: "2026-12-02T05:00:00.000Z",
      place: { type: "lookup" as const, query: "CodeRabbit, 201 Spear St" },
      ideaId: idea.id,
    };
    const { exit, requests } = await run((s) => s.create(input, false), {
      "/v1/events/create": [json({ id: "evt-NewOne1" })],
    });
    expect(value(exit).lumaEventId).toBe("evt-NewOne1");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: "https://public-api.luma.com/v1/events/create",
      method: "POST",
      apiKey: key,
    });
    expect(JSON.parse(requests[0]?.body ?? "")).toEqual({
      name: "All Things Made Up",
      start_at: "2026-12-02T02:00:00.000Z",
      end_at: "2026-12-02T05:00:00.000Z",
      timezone: "America/Los_Angeles",
      geo_address_json: { type: "lookup", query: "CodeRabbit, 201 Spear St" },
      visibility: "private",
      description_md: "Rounds on everything.",
    });

    const dry = await run((s) => s.create(input, true), {});
    expect(value(dry.exit).lumaEventId).toBeNull();
    expect(dry.requests).toEqual([]);
  });

  test("sends a create once, even when Luma doesn't answer", async () => {
    const { exit, requests } = await run(
      (s) =>
        s.create(
          {
            name: "X",
            startAt: "2026-12-02T02:00:00.000Z",
            endAt: "2026-12-02T05:00:00.000Z",
            place: { type: "manual", address: "1 Market St" },
          },
          false,
        ),
      { "/v1/events/create": [{ status: 503 }] },
    );
    expect(message(exit)).toBe("Luma event request failed: 503");
    expect(requests).toHaveLength(1);
  });

  test("refuses times that run backwards, and a missing key, sending nothing", async () => {
    const input = {
      name: "X",
      startAt: "2026-12-02T05:00:00.000Z",
      endAt: "2026-12-02T02:00:00.000Z",
      place: { type: "manual" as const, address: "1 Market St" },
    };
    const backwards = await run((s) => s.create(input, false), {});
    expect(message(backwards.exit)).toBe("An evening ends after it starts.");
    const keyless = await run(
      (s) =>
        s.create(
          { ...input, startAt: input.endAt, endAt: input.startAt },
          false,
        ),
      {},
      {},
    );
    expect(message(keyless.exit)).toBe(
      "LUMA_API_KEY is not set: nothing can be written to Luma.",
    );
    expect([...backwards.requests, ...keyless.requests]).toEqual([]);
  });
});

describe("update", () => {
  test("sets a private event's description to an idea's pitch, as create does", async () => {
    const idea = await Effect.runPromise(
      Planning.use((p) =>
        p.addIdea({
          title: "Made-up quiz",
          pitch: "The hard one.\n\n**How it works**",
          program: "social",
        }),
      ).pipe(
        Effect.provide(
          Planning.layer.pipe(
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );
    const { exit, requests } = await run(
      (s) =>
        s.update(
          { _tag: "Luma", lumaEventId: "evt-draft" },
          { descriptionFromIdea: idea.id },
          false,
        ),
      {
        "/v1/events/get": [json(lumaEvent())],
        "/v1/events/update": [json({})],
      },
    );
    expect(value(exit).body).toEqual({
      description_md: "The hard one.\n\n**How it works**",
    });
    expect(JSON.parse(requests[1]?.body ?? "")).toEqual({
      event_id: "evt-draft",
      description_md: "The hard one.\n\n**How it works**",
    });

    const unknown = await run(
      (s) =>
        s.update(
          { _tag: "Luma", lumaEventId: "evt-draft" },
          { descriptionFromIdea: "00000000-0000-4000-8000-000000000000" },
          false,
        ),
      { "/v1/events/get": [json(lumaEvent())] },
    );
    expect(message(unknown.exit)).toBe(
      "No idea has the id 00000000-0000-4000-8000-000000000000.",
    );
    const both = await run(
      (s) =>
        s.update(
          { _tag: "Slug", slug: draft },
          { descriptionFromIdea: idea.id, descriptionFromDrafts: draft },
          false,
        ),
      { "/v1/events/get": [json(lumaEvent())] },
    );
    expect(message(both.exit)).toBe(
      "Set the description from the drafts or from an idea, not both.",
    );
    for (const { requests: sent } of [unknown, both]) {
      expect(sent.some((r) => r.url.endsWith("/v1/events/update"))).toBe(false);
    }
  });

  test("sets a private draft's description from its promotion drafts, and never a cover", async () => {
    const { exit, requests } = await run(
      (s) =>
        s.update(
          { _tag: "Slug", slug: draft },
          { descriptionFromDrafts: draft },
          false,
        ),
      {
        "/v1/events/get": [json(lumaEvent())],
        "/v1/events/update": [json({})],
      },
    );
    const { body } = value(exit);
    expect(body.description_md).toContain("**Secret talk**");
    // Its cover is set only by luma cover, drawn from its facts.
    expect("cover_url" in body).toBe(false);
    expect(
      requests.map(
        (r) => `${r.method} ${new URL(r.url).pathname} ${r.apiKey ?? "-"}`,
      ),
    ).toEqual([`GET /v1/events/get ${key}`, `POST /v1/events/update ${key}`]);
    expect(JSON.parse(requests[1]?.body ?? "")).toEqual({
      event_id: "evt-draft",
      ...body,
    });
  });

  test("refuses a public event: the public sees changes only through publish", async () => {
    const { exit, requests } = await run(
      (s) =>
        s.update(
          { _tag: "Luma", lumaEventId: "evt-draft" },
          { name: "New" },
          false,
        ),
      { "/v1/events/get": [json(lumaEvent({ visibility: "public" }))] },
    );
    expect(message(exit)).toBe(
      "Draft night is public: what the public sees changes only through publish.",
    );
    expect(requests.map((r) => r.method)).toEqual(["GET"]);
  });

  test("refuses a published evening and an event another calendar manages", async () => {
    await db.exec(`UPDATE events SET is_draft = false WHERE slug = '${draft}'`);
    const published = await run(
      (s) => s.update({ _tag: "Slug", slug: draft }, { name: "New" }, false),
      {},
    );
    expect(message(published.exit)).toBe(`${draft} is already published.`);
    const theirs = await run(
      (s) =>
        s.update(
          { _tag: "Luma", lumaEventId: "evt-draft" },
          { name: "New" },
          false,
        ),
      { "/v1/events/get": [json(lumaEvent({ access: "view" }))] },
    );
    expect(message(theirs.exit)).toBe(
      "evt-draft is not our calendar's to change.",
    );
  });
});

describe("publish", () => {
  test("says what would go out, with its token, and sends nothing", async () => {
    const { exit, requests } = await run((s) => s.prepare(draft), {
      "/v1/events/get": [json(lumaEvent())],
    });
    const prepared = value(exit);
    expect(prepared.from).toBe("private");
    expect(prepared.outgoing).toMatchObject({
      lumaEventId: "evt-draft",
      name: "Draft night",
      address: "201 Spear St, San Francisco, CA 94105",
      coverUrl: "https://images.lumacdn.com/cover.png",
      visibility: "public",
    });
    expect(prepared.outgoing.descriptionMd).toContain("Hosted at **[Acme]");
    expect(prepared.token).toBe(
      await Effect.runPromise(approvalToken(prepared.outgoing)),
    );
    expect(requests.map((r) => r.method)).toEqual(["GET"]);
  });

  test("an evening with no talks that comes from an idea keeps the idea's pitch", async () => {
    // The draft as a social evening, its talks gone, from an idea.
    await db.exec(`
      UPDATE events SET program = 'social' WHERE slug = '${draft}';
      DELETE FROM event_talks WHERE event_id = (SELECT id FROM events WHERE slug = '${draft}');`);
    const pitch = "The hard one.\n\n**How it works**\n\n- Teams of up to four.";
    await Effect.runPromise(
      Planning.use((p) =>
        p.addIdea({
          title: "Made-up quiz",
          pitch,
          program: "social",
          status: "drafting",
          eventSlug: draft,
        }),
      ).pipe(
        Effect.provide(
          Planning.layer.pipe(
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );
    const { exit } = await run((s) => s.prepare(draft), {
      "/v1/events/get": [json(lumaEvent())],
    });
    const prepared = value(exit);
    expect(prepared.outgoing.descriptionMd).toBe(pitch);
    expect(prepared.token).toBe(
      await Effect.runPromise(approvalToken(prepared.outgoing)),
    );
  });

  test("a shared evening is refused, idea or not", async () => {
    await db.exec(`
      UPDATE events SET program = 'social', curation = 'shared',
        organized_by = (SELECT id FROM sponsors ORDER BY id LIMIT 1)
      WHERE slug = '${draft}';
      DELETE FROM event_talks WHERE event_id = (SELECT id FROM events WHERE slug = '${draft}');`);
    await Effect.runPromise(
      Planning.use((p) =>
        p.addIdea({
          title: "Made-up quiz",
          pitch: "Not ours to publish.",
          program: "social",
          status: "drafting",
          eventSlug: draft,
        }),
      ).pipe(
        Effect.provide(
          Planning.layer.pipe(
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );
    const { exit } = await run((s) => s.prepare(draft), {
      "/v1/events/get": [json(lumaEvent())],
    });
    expect(message(exit)).toContain(
      "is shared: its Luma page is its organizer's.",
    );
  });

  test("a dropped idea's pitch is not used", async () => {
    await db.exec(`
      UPDATE events SET program = 'social' WHERE slug = '${draft}';
      DELETE FROM event_talks WHERE event_id = (SELECT id FROM events WHERE slug = '${draft}');`);
    await Effect.runPromise(
      Planning.use((p) =>
        p.addIdea({
          title: "Made-up quiz",
          pitch: "Dropped, not this.",
          program: "social",
          status: "dropped",
          eventSlug: draft,
        }),
      ).pipe(
        Effect.provide(
          Planning.layer.pipe(
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );
    const { exit } = await run((s) => s.prepare(draft), {
      "/v1/events/get": [json(lumaEvent())],
    });
    const description = value(exit).outgoing.descriptionMd;
    expect(description).not.toContain("Dropped, not this.");
    expect(description).toContain("Hosted at **[Acme]");
  });

  test("an evening with talks takes the drafts' description, idea or not", async () => {
    await Effect.runPromise(
      Planning.use((p) =>
        p.addIdea({
          title: "Made-up talks",
          pitch: "Not this.",
          program: "talks",
          status: "drafting",
          eventSlug: draft,
        }),
      ).pipe(
        Effect.provide(
          Planning.layer.pipe(
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );
    const { exit } = await run((s) => s.prepare(draft), {
      "/v1/events/get": [json(lumaEvent())],
    });
    const description = value(exit).outgoing.descriptionMd;
    expect(description).toContain("Hosted at **[Acme]");
    expect(description).not.toContain("Not this.");
  });

  test("puts out exactly what was approved, and checks Luma took it", async () => {
    const prepared = value(
      (
        await run((s) => s.prepare(draft), {
          "/v1/events/get": [json(lumaEvent())],
        })
      ).exit,
    );
    const { exit, requests } = await run(
      (s) => s.publish(draft, prepared.token),
      {
        "/v1/events/get": [
          json(lumaEvent()),
          json(
            lumaEvent({
              visibility: "public",
              description_md: prepared.outgoing.descriptionMd,
            }),
          ),
        ],
        "/v1/events/update": [json({})],
      },
    );
    expect(value(exit).url).toBe("https://luma.com/draft-night");
    const update = requests.find((r) => r.url.endsWith("/v1/events/update"));
    expect(JSON.parse(update?.body ?? "")).toEqual({
      event_id: "evt-draft",
      description_md: prepared.outgoing.descriptionMd,
      visibility: "public",
    });
  });

  test("publishing gives the evening the program its idea planned", async () => {
    await Effect.runPromise(
      Planning.use((p) =>
        p.addIdea({
          title: "Made-up social",
          pitch: "Not this.",
          program: "social",
          status: "drafting",
          eventSlug: draft,
        }),
      ).pipe(
        Effect.provide(
          Planning.layer.pipe(
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );
    const program = async () =>
      (
        await db.query<{ program: string }>(
          `SELECT program FROM events WHERE slug = '${draft}'`,
        )
      ).rows[0]?.program;
    const prepared = value(
      (
        await run((s) => s.prepare(draft), {
          "/v1/events/get": [json(lumaEvent())],
        })
      ).exit,
    );
    // Reading what would go out changes nothing.
    expect(await program()).toBe("talks");
    const { exit } = await run((s) => s.publish(draft, prepared.token), {
      "/v1/events/get": [
        json(lumaEvent()),
        json(
          lumaEvent({
            visibility: "public",
            description_md: prepared.outgoing.descriptionMd,
          }),
        ),
      ],
      "/v1/events/update": [json({})],
    });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(await program()).toBe("social");
  });

  test("a draft Luma doesn't make public keeps the program it had", async () => {
    await Effect.runPromise(
      Planning.use((p) =>
        p.addIdea({
          title: "Made-up social",
          pitch: "Not this.",
          program: "social",
          status: "drafting",
          eventSlug: draft,
        }),
      ).pipe(
        Effect.provide(
          Planning.layer.pipe(
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );
    const program = async () =>
      (
        await db.query<{ program: string }>(
          `SELECT program FROM events WHERE slug = '${draft}'`,
        )
      ).rows[0]?.program;
    const prepared = value(
      (
        await run((s) => s.prepare(draft), {
          "/v1/events/get": [json(lumaEvent())],
        })
      ).exit,
    );
    for (const replies of [
      // Luma refuses the update.
      {
        "/v1/events/get": [json(lumaEvent())],
        "/v1/events/update": [{ status: 503 }],
      },
      // Luma takes it, and the event is still private.
      {
        "/v1/events/get": [json(lumaEvent()), json(lumaEvent())],
        "/v1/events/update": [json({})],
      },
    ]) {
      const { exit } = await run(
        (s) => s.publish(draft, prepared.token),
        replies,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(await program()).toBe("talks");
    }
    // Luma took the update but couldn't be read back: it may be public, so
    // the planned program stays.
    const unknown = await run((s) => s.publish(draft, prepared.token), {
      "/v1/events/get": [json(lumaEvent()), { status: 503 }],
      "/v1/events/update": [json({})],
    });
    expect(Exit.isFailure(unknown.exit)).toBe(true);
    expect(await program()).toBe("social");
  });

  test("publishing copies the draft's private lineup to the evening, and takes it back if Luma doesn't", async () => {
    await Effect.runPromise(
      Planning.use((p) =>
        p.setDraftLineup(draft, [
          { role: "organizer", profile: "Ada Lovelace" },
          { role: "mc", profile: "Ada Lovelace" },
        ]),
      ).pipe(
        Effect.provide(
          Planning.layer.pipe(
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );
    const lineup = async () =>
      (
        await db.query<{ name: string; role: string; source: string }>(
          `SELECT p.name, ep.role, ep.source FROM event_people ep
           JOIN profiles p ON p.id = ep.profile_id JOIN events e ON e.id = ep.event_id
           WHERE e.slug = '${draft}' ORDER BY ep.role, p.name`,
        )
      ).rows;
    const before = await lineup();
    const prepared = value(
      (
        await run((s) => s.prepare(draft), {
          "/v1/events/get": [json(lumaEvent())],
        })
      ).exit,
    );
    expect(await lineup()).toEqual(before);
    const refused = await run((s) => s.publish(draft, prepared.token), {
      "/v1/events/get": [json(lumaEvent())],
      "/v1/events/update": [{ status: 503 }],
    });
    expect(Exit.isFailure(refused.exit)).toBe(true);
    expect(await lineup()).toEqual(before);
    const { exit } = await run((s) => s.publish(draft, prepared.token), {
      "/v1/events/get": [
        json(lumaEvent()),
        json(
          lumaEvent({
            visibility: "public",
            description_md: prepared.outgoing.descriptionMd,
          }),
        ),
      ],
      "/v1/events/update": [json({})],
    });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(await lineup()).toEqual(
      expect.arrayContaining([
        { name: "Ada Lovelace", role: "organizer", source: "site" },
        { name: "Ada Lovelace", role: "mc", source: "site" },
      ]),
    );
    // Each step in its draft's log: the lineup, the claim Luma refused and
    // its taking back, then the claim and the publish (lines made in one
    // instant may come in either order).
    expect((await logged()).map((line) => line.summary).toSorted()).toEqual(
      [
        "Its lineup is now 1 organizer, 1 mc.",
        "Claimed its publish, with 1 of its lineup copied to the public one.",
        "Luma didn't make it public: the 1 copied to its public lineup taken back, its claim let go.",
        "Claimed its publish, with 1 of its lineup copied to the public one.",
        "Published: public on Luma at https://luma.com/draft-night.",
      ].toSorted(),
    );
  });

  test("a lineup changed after approval is refused, and one copied can't be changed", async () => {
    const planning = <A, E>(
      f: (p: Planning["Service"]) => Effect.Effect<A, E>,
    ) =>
      Effect.runPromise(
        Planning.use(f).pipe(
          Effect.provide(
            Planning.layer.pipe(
              Layer.provideMerge(sqlLayer(db)),
              Layer.provideMerge(clockLayer),
            ),
          ),
        ),
      );
    await planning((p) =>
      p.setDraftLineup(draft, [{ role: "mc", profile: "Ada Lovelace" }]),
    );
    const prepared = value(
      (
        await run((s) => s.prepare(draft), {
          "/v1/events/get": [json(lumaEvent())],
        })
      ).exit,
    );
    expect(prepared.lineup.map(({ role, name }) => [role, name])).toEqual([
      ["mc", "Ada Lovelace"],
    ]);
    await planning((p) =>
      p.setDraftLineup(draft, [{ role: "organizer", profile: "Ada Lovelace" }]),
    );
    const stale = await run((s) => s.publish(draft, prepared.token), {
      "/v1/events/get": [json(lumaEvent())],
      "/v1/events/update": [json({})],
    });
    expect(message(stale.exit)).toMatch(/^What would go out has changed since/);

    const fresh = value(
      (
        await run((s) => s.prepare(draft), {
          "/v1/events/get": [json(lumaEvent())],
        })
      ).exit,
    );
    const published = await run((s) => s.publish(draft, fresh.token), {
      "/v1/events/get": [
        json(lumaEvent()),
        json(
          lumaEvent({
            visibility: "public",
            description_md: fresh.outgoing.descriptionMd,
          }),
        ),
      ],
      "/v1/events/update": [json({})],
    });
    expect(Exit.isSuccess(published.exit)).toBe(true);
    // Copied, the evening is being published: its lineup is the public one.
    const changed = await Effect.runPromiseExit(
      Planning.use((p) =>
        p.setDraftLineup(draft, [{ role: "mc", profile: "Linus" }]),
      ).pipe(
        Effect.provide(
          Planning.layer.pipe(
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );
    expect(message(changed)).toBe(
      `${draft} is published: its lineup is the public one (core/backfill/lineups.json).`,
    );
  });

  test("a publish is claimed: another can't overlap it, and once published the lineup is fixed, even with none", async () => {
    const claims = async () =>
      (
        await db.query<{ status: string }>(
          "SELECT status FROM planning.publishes ORDER BY status",
        )
      ).rows.map((row) => row.status);
    const prepared = value(
      (
        await run((s) => s.prepare(draft), {
          "/v1/events/get": [json(lumaEvent())],
        })
      ).exit,
    );
    // Another publish holds the claim: this one sends nothing to Luma.
    await db.exec(`INSERT INTO planning.publishes (event_id, status, claimed_at)
      SELECT id, 'publishing', '2026-10-03T18:58:00Z' FROM events WHERE slug = '${draft}'`);
    const overlapping = await run((s) => s.publish(draft, prepared.token), {
      "/v1/events/get": [json(lumaEvent())],
      "/v1/events/update": [json({})],
    });
    expect(message(overlapping.exit)).toMatch(
      /^Another publish of 2026-09-01-draft-night started at 2026-10-03T18:58:00\.000Z and hasn't finished/,
    );
    expect(
      overlapping.requests.some((r) => r.url.endsWith("/v1/events/update")),
    ).toBe(false);
    // Luma refuses: the claim goes, as if nothing had started.
    await db.exec("DELETE FROM planning.publishes");
    const refused = await run((s) => s.publish(draft, prepared.token), {
      "/v1/events/get": [json(lumaEvent())],
      "/v1/events/update": [{ status: 503 }],
    });
    expect(Exit.isFailure(refused.exit)).toBe(true);
    expect(await claims()).toEqual([]);
    // Published, with no private lineup: recorded, and the lineup is fixed.
    const { exit } = await run((s) => s.publish(draft, prepared.token), {
      "/v1/events/get": [
        json(lumaEvent()),
        json(
          lumaEvent({
            visibility: "public",
            description_md: prepared.outgoing.descriptionMd,
          }),
        ),
      ],
      "/v1/events/update": [json({})],
    });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(await claims()).toEqual(["published"]);
    const changed = await Effect.runPromiseExit(
      Planning.use((p) =>
        p.setDraftLineup(draft, [{ role: "mc", profile: "Linus" }]),
      ).pipe(
        Effect.provide(
          Planning.layer.pipe(
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );
    expect(message(changed)).toBe(
      `${draft} is published: its lineup is the public one (core/backfill/lineups.json).`,
    );
  });

  test("refuses a token for anything else, sending no update", async () => {
    const prepared = value(
      (
        await run((s) => s.prepare(draft), {
          "/v1/events/get": [json(lumaEvent())],
        })
      ).exit,
    );
    // The event was renamed on Luma after the approval.
    const { exit, requests } = await run(
      (s) => s.publish(draft, prepared.token),
      {
        "/v1/events/get": [json(lumaEvent({ name: "Draft night, renamed" }))],
      },
    );
    expect(message(exit)).toMatch(
      new RegExp(
        `^What would go out has changed since ${prepared.token} was approved: it is now [0-9a-f]{16}\\.`,
      ),
    );
    expect(requests.some((r) => r.method === "POST")).toBe(false);
  });

  test("refuses while readiness finds a blocker, before asking Luma", async () => {
    await db.exec(
      `DELETE FROM event_sponsors WHERE event_id = 'e0000000-0000-4000-8000-000000000002'`,
    );
    const { exit, requests } = await run((s) => s.prepare(draft), {});
    // Its cover named the host, so it is drawn for facts that changed too.
    expect(message(exit)).toBe(
      "Not ready: No hosting company; Its cover was drawn before its day, place, hosts or link changed: draw it again with bun run luma cover 2026-09-01-draft-night --dry-run, then --approve <token>.",
    );
    expect(requests).toEqual([]);
  });

  test("refuses while Luma shows a cover that isn't the one we set", async () => {
    const gallery =
      "https://images.lumacdn.com/gallery-images/kd/12b33577-492a-4ae2-af6f-f7cd814d862c";
    const lumaDefault = await run((s) => s.prepare(draft), {
      "/v1/events/get": [json(lumaEvent({ cover_url: gallery }))],
    });
    expect(message(lumaDefault.exit)).toBe(
      `Not ready: its cover on Luma is Luma's default (${gallery}). Draw and set ours with bun run luma cover ${draft} --dry-run, then --approve <token>.`,
    );
    const byHand = "https://images.lumacdn.com/event-covers/xx/by-hand.png";
    const another = await run((s) => s.prepare(draft), {
      "/v1/events/get": [json(lumaEvent({ cover_url: byHand }))],
    });
    expect(message(another.exit)).toBe(
      `Not ready: its cover on Luma (${byHand}) isn't the one we set (${ourCover}). Draw and set ours with bun run luma cover ${draft} --dry-run, then --approve <token>.`,
    );
    const none = await run((s) => s.prepare(draft), {
      "/v1/events/get": [json(lumaEvent({ cover_url: null }))],
    });
    expect(message(none.exit)).toStartWith(
      "Not ready: its cover on Luma (none)",
    );
    for (const { requests } of [lumaDefault, another, none]) {
      expect(requests.some((r) => r.method === "POST")).toBe(false);
    }
  });

  test("fails when Luma didn't make it public", async () => {
    const prepared = value(
      (
        await run((s) => s.prepare(draft), {
          "/v1/events/get": [json(lumaEvent())],
        })
      ).exit,
    );
    const { exit } = await run((s) => s.publish(draft, prepared.token), {
      "/v1/events/get": [json(lumaEvent()), json(lumaEvent())],
      "/v1/events/update": [json({})],
    });
    expect(message(exit)).toBe(
      "Luma took the update but Draft night is still private.",
    );
  });
});

describe("cancelTest", () => {
  test("deletes a private test event without guests, in Luma's two steps", async () => {
    const { exit, requests } = await run((s) => s.cancelTest("evt-Test1"), {
      "/v1/events/get": [
        json(
          lumaEvent({
            id: "evt-Test1",
            name: "allthings API test — delete me",
          }),
        ),
      ],
      "/v1/events/cancel/request": [
        json({ cancellation_token: "tok", is_paid: false, guest_count: 0 }),
      ],
      "/v1/events/cancel": [json({})],
    });
    expect(value(exit).name).toBe("allthings API test — delete me");
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
      "/v1/events/get",
      "/v1/events/cancel/request",
      "/v1/events/cancel",
    ]);
    expect(JSON.parse(requests[2]?.body ?? "")).toEqual({
      event_id: "evt-Test1",
      cancellation_token: "tok",
    });
  });

  for (const [name, event] of [
    ["a real evening", lumaEvent({ id: "evt-Test1" })],
    [
      "a public test event",
      lumaEvent({
        id: "evt-Test1",
        name: "allthings API test",
        visibility: "public",
      }),
    ],
    [
      "a test event with guests",
      lumaEvent({
        id: "evt-Test1",
        name: "allthings API test",
        guest_counts: { approved: { guests: 1 } },
      }),
    ],
  ] as const) {
    test(`never cancels ${name}`, async () => {
      const { exit, requests } = await run((s) => s.cancelTest("evt-Test1"), {
        "/v1/events/get": [json(event)],
      });
      expect(message(exit)).toMatch(
        /^Only a private test event named "allthings API test…" with no guests is ever cancelled/,
      );
      expect(requests.map((r) => r.method)).toEqual(["GET"]);
    });
  }
});

describe("reading Luma's answers", () => {
  test("decodes a managed event's full answer, and a viewed one's", async () => {
    const managedBody = await fixture("event-manage.json");
    const viewedBody = await fixture("event-view.json");
    const read = (body: string, id: string) =>
      Effect.runPromise(
        settle(LumaWrite.use((write) => write.get(id))).pipe(
          Effect.provide(
            LumaWrite.layer.pipe(
              Layer.provide(
                Layer.mergeAll(
                  fakeLumaBy(() => "", { "": [{ body }] }).layer,
                  configFrom({ LUMA_API_KEY: key }),
                ),
              ),
            ),
          ),
          Effect.provide(clockLayer),
        ),
      );
    expect(await read(managedBody, "evt-react")).toMatchObject({
      id: "evt-react",
      access: "manage",
      visibility: "public",
      cover_url: "https://images.lumacdn.com/event-covers/react.png",
      guest_counts: { approved: { guests: 183 } },
    });
    const viewed = JSON.parse(viewedBody) as { id: string };
    expect(await read(viewedBody, viewed.id)).toMatchObject({ access: "view" });
  });
});

describe("times as Luma writes them", () => {
  test("an update compares instants, whatever offset Luma answers with", async () => {
    // Luma answers 6 PM in San Francisco with an offset; the new end is 9 PM.
    const { exit } = await run(
      (s) =>
        s.update(
          { _tag: "Luma", lumaEventId: "evt-draft" },
          { endAt: "2026-11-18T05:00:00.000Z" },
          true,
        ),
      {
        "/v1/events/get": [
          json(
            lumaEvent({
              start_at: "2026-11-17T18:00:00-08:00",
              end_at: "2026-11-17T20:00:00-08:00",
            }),
          ),
        ],
      },
    );
    expect(value(exit).body).toEqual({
      end_at: "2026-11-18T05:00:00.000Z",
      timezone: "America/Los_Angeles",
    });
    const backwards = await run(
      (s) =>
        s.update(
          { _tag: "Luma", lumaEventId: "evt-draft" },
          { endAt: "2026-11-18T01:00:00.000Z" },
          true,
        ),
      {
        "/v1/events/get": [
          json(lumaEvent({ start_at: "2026-11-17T18:00:00-08:00" })),
        ],
      },
    );
    expect(message(backwards.exit)).toBe("An evening ends after it starts.");
  });
});
