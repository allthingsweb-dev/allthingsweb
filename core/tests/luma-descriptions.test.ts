import { afterAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Exit, Layer, Option } from "effect";
import {
  LumaApi,
  type LumaApiError,
  type LumaEventDescription,
} from "../src/luma/api.ts";
import {
  descriptionHtml,
  descriptionSummary,
  summaryLimit,
} from "../src/luma/description.ts";
import { formatDescriptions } from "../src/luma/descriptions-report.ts";
import {
  type DescriptionsImport,
  type DescriptionsOptions,
  LumaDescriptions,
} from "../src/luma/descriptions.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";
import {
  configFrom,
  fakeLumaBy,
  fixture,
  type Reply,
  settle,
} from "./support/luma.ts";

/**
 * Each event's description from Luma's API: the Markdown of Luma's editor
 * made into rich text and a one-line summary, as pure functions, then the
 * client against fixtures in the shape docs.luma.com documents, and the
 * import against tests/seed.sql. No test reaches Luma.
 */

/** The stored HTML, as a plain string to compare. */
const html = (markdown: string | null): Promise<string | null> =>
  Effect.runPromise(descriptionHtml(markdown));

describe("a description as the site keeps it", () => {
  test("keeps paragraphs, emphasis, lists and links, sanitized", async () => {
    expect(
      await html(
        "Join us at **CodeRabbit** for _talks_.\n\n*   [Ada](https://example.com/ada), CEO\n*   Grace\n\nA [bad link](javascript:alert(1)) stays text.",
      ),
    ).toBe(
      [
        "<p>Join us at <strong>CodeRabbit</strong> for <em>talks</em>.</p>",
        "<ul>",
        '<li><a href="https://example.com/ada" target="_blank" rel="noopener noreferrer">Ada</a>, CEO</li>',
        "<li>Grace</li>",
        "</ul>",
        '<p>A <a target="_blank" rel="noopener noreferrer">bad link</a> stays text.</p>',
        "",
      ].join("\n"),
    );
  });

  test("makes headings bold paragraphs, once, and drops images, rules, raw HTML and dividers", async () => {
    expect(
      await html(
        "# **​​​​Talks & Speakers**\n\n![](https://images.lumacdn.com/a.jpg)\n\n---\n\n\\--\n\n<div>raw</div>\n\n## Schedule\n\nDoors at 6.",
      ),
    ).toBe(
      [
        "<p><strong>Talks &amp; Speakers</strong></p>",
        "<p><strong>Schedule</strong></p>",
        "<p>Doors at 6.</p>",
        "",
      ].join("\n"),
    );
  });

  test("is nothing when Luma has none, or nothing but an image", async () => {
    expect(await html(null)).toBeNull();
    expect(await html("")).toBeNull();
    expect(await html("  \n​ ")).toBeNull();
    expect(await html("![](https://images.lumacdn.com/a.jpg)")).toBeNull();
  });
});

describe("a description's summary", () => {
  test("is the first paragraph's leading sentences that fit", () => {
    expect(
      descriptionSummary(
        "Everyone is rolling their own agentic setup right now. Show us yours!\n\nJoin us on Tuesday.",
      ),
    ).toBe(
      "Everyone is rolling their own agentic setup right now. Show us yours!",
    );
    const long = `${"word ".repeat(45).trim()}.`;
    expect(
      descriptionSummary(`Development is changing in real time. ${long}`),
    ).toBe("Development is changing in real time.");
    expect(summaryLimit).toBe(200);
  });

  test("skips headings, lists, bold lines, labels, links and greetings", () => {
    expect(
      descriptionSummary(
        [
          "# TypeScript AI Demo Day",
          "**Location: Pier 70 (Dogpatch)**",
          "*   A list item that reads as a sentence, with enough words.",
          "CATCH THE LIVESTREAM AT 9:40AM PST:",
          "[https://youtube.com/watch?v=x](https://youtube.com/watch?v=x)",
          "Welcome to 2026 everyone! 🎉",
          "Teams who've shipped AI applications in TypeScript are going on stage.",
        ].join("\n\n"),
      ),
    ).toBe(
      "Teams who've shipped AI applications in TypeScript are going on stage.",
    );
  });

  test("reads text as people see it: no markup, emoji or footnote marks", () => {
    expect(
      descriptionSummary(
        "Join us at **CodeRabbit** for [all things sync](https://x.com) 🚀 and NO AI IS ALLOWED!\\*\n\n\\*Except one team.",
      ),
    ).toBe("Join us at CodeRabbit for all things sync and NO AI IS ALLOWED!");
  });

  test("is nothing when no paragraph reads as prose", () => {
    expect(descriptionSummary(null)).toBeNull();
    expect(descriptionSummary("# Schedule\n\n*   6 pm: doors")).toBeNull();
    expect(descriptionSummary(`${"long ".repeat(50)}sentence.`)).toBeNull();
  });
});

const managed = await fixture("event-manage.json");
const withKey = { LUMA_API_KEY: "test-key" };

/** A fake Luma answering by the event each request asks about. */
const fakeApi = (replies: Readonly<Record<string, ReadonlyArray<Reply>>>) =>
  fakeLumaBy((url) => url.searchParams.get("event_id") ?? "", replies);

/** Luma's answer for `id`, describing it with `markdown`. */
const answer = (id: string, markdown: string | null): Reply => ({
  body: managed
    .replace('"id": "evt-react"', `"id": ${JSON.stringify(id)}`)
    .replace(
      '"description_md": "Server components in practice."',
      `"description_md": ${JSON.stringify(markdown)}`,
    ),
});

describe("Luma's API", () => {
  const ask = (
    replies: ReadonlyArray<Reply>,
    env: Record<string, string> = withKey,
  ) => {
    const luma = fakeApi({ "evt-react": replies });
    return Effect.runPromiseExit(
      settle(
        LumaApi.use((api) =>
          Option.match(api.eventDescription, {
            onNone: (): Effect.Effect<
              "no key" | Option.Option<LumaEventDescription>,
              LumaApiError
            > => Effect.succeed("no key"),
            onSome: (eventDescription) => eventDescription("evt-react"),
          }),
        ),
      ).pipe(
        Effect.provide(
          LumaApi.layer.pipe(
            Layer.provide(Layer.mergeAll(luma.layer, configFrom(env))),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    ).then((exit) => ({ exit, requests: luma.requests }));
  };

  test("reads an event's description in Markdown", async () => {
    const { exit, requests } = await ask([{ body: managed }]);
    expect(exit).toEqual(
      Exit.succeed(
        Option.some({
          lumaEventId: "evt-react",
          markdown: "Server components in practice.",
        }),
      ),
    );
    expect(requests.map(({ url }) => url)).toEqual([
      "https://public-api.luma.com/v1/events/get?event_id=evt-react",
    ]);
  });

  test("an empty description is none", async () => {
    for (const markdown of ["", "  ", null]) {
      const { exit } = await ask([answer("evt-react", markdown)]);
      expect(exit).toEqual(
        Exit.succeed(Option.some({ lumaEventId: "evt-react", markdown: null })),
      );
    }
  });

  test("has nothing to ask without LUMA_API_KEY, and nothing to say about an event it hides", async () => {
    expect((await ask([{ body: managed }], {})).exit).toEqual(
      Exit.succeed("no key"),
    );
    expect((await ask([{ status: 404 }])).exit).toEqual(
      Exit.succeed(Option.none()),
    );
  });
});

describe("the import", () => {
  const opened: Array<PGlite> = [];
  afterAll(() => Promise.all(opened.map((db) => db.close())));

  /** tests/seed.sql, with the upcoming event's Luma id one Luma would send. */
  const database = async () => {
    const db = await seededDatabase();
    opened.push(db);
    await db.exec(
      `UPDATE events SET luma_event_id = 'evt-upcoming' WHERE id = 'e0000000-0000-4000-8000-000000000004'`,
    );
    return db;
  };

  const summary =
    "Server components in practice, with two talks and time to talk after.";
  const described =
    "Server components in practice, with **two talks** and time to talk after.";
  const upcoming =
    "# **Soon**\n\nAn evening of talks about the web, in the East Cut. Doors at 6.";

  const importInto = async (
    db: PGlite,
    replies: Readonly<Record<string, ReadonlyArray<Reply>>> = {
      "evt-react": [answer("evt-react", described)],
      "evt-upcoming": [answer("evt-upcoming", upcoming)],
    },
    options: Partial<DescriptionsOptions> & {
      env?: Record<string, string>;
    } = {},
  ) => {
    const { env = withKey, ...rest } = options;
    const luma = fakeApi(replies);
    const exit = await Effect.runPromiseExit(
      settle(
        LumaDescriptions.use((descriptions) =>
          descriptions.run({ dryRun: false, ...rest }),
        ),
      ).pipe(
        Effect.provide(
          LumaDescriptions.layer.pipe(
            Layer.provide(LumaApi.layer),
            Layer.provide(Layer.mergeAll(luma.layer, configFrom(env))),
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    return { result: exit.value, requests: luma.requests };
  };

  const planned = (
    result: DescriptionsImport,
  ): Extract<DescriptionsImport, { _tag: "Planned" }> => {
    if (result._tag !== "Planned") throw new Error("skipped");
    return result;
  };

  const stored = async (db: PGlite) =>
    (
      await db.query<{
        slug: string;
        tagline: string;
        description: string | null;
        luma_description: string | null;
        luma_summary: string | null;
        updated_at: Date;
      }>(
        `SELECT slug, tagline, description, luma_description, luma_summary, updated_at
         FROM events WHERE luma_event_id IN ('evt-react', 'evt-upcoming', 'evt-draft')
         ORDER BY slug`,
      )
    ).rows;

  test("does nothing without LUMA_API_KEY", async () => {
    const db = await database();
    const { result, requests } = await importInto(db, undefined, { env: {} });
    expect(result).toEqual({
      _tag: "Skipped",
      reason: "LUMA_API_KEY is not set",
    });
    expect(requests).toEqual([]);
  });

  test("writes Luma's description and summary of each published event, and nothing of the site's", async () => {
    const db = await database();
    const before = await stored(db);
    const { result, requests } = await importInto(db);
    const done = planned(result);
    expect(done).toMatchObject({ asked: 2, unavailable: [], written: 1 });
    // The draft is never asked about.
    expect(
      requests.map(({ url }) => new URL(url).searchParams.get("event_id")),
    ).toEqual(["evt-upcoming", "evt-react"]);
    const after = await stored(db);
    expect(
      after.map(({ slug, luma_description, luma_summary }) => ({
        slug,
        luma_description,
        luma_summary,
      })),
    ).toEqual([
      {
        slug: "2026-08-12-react-at-acme",
        luma_description:
          "<p>Server components in practice, with <strong>two talks</strong> and time to talk after.</p>\n",
        luma_summary: summary,
      },
      {
        slug: "2026-09-01-draft-night",
        luma_description: null,
        luma_summary: null,
      },
      {
        slug: "2026-11-05-upcoming",
        luma_description:
          "<p><strong>Soon</strong></p>\n<p>An evening of talks about the web, in the East Cut. Doors at 6.</p>\n",
        luma_summary:
          "An evening of talks about the web, in the East Cut. Doors at 6.",
      },
    ]);
    // Taglines and the site's own descriptions are the site's.
    expect(
      after.map(({ tagline, description }) => ({ tagline, description })),
    ).toEqual(
      before.map(({ tagline, description }) => ({ tagline, description })),
    );
    // Only the event that changed is written, at the Clock's now.
    const changed = after.filter(
      (row, i) => row.updated_at.getTime() !== before[i]?.updated_at.getTime(),
    );
    expect(
      changed.map(({ slug, updated_at }) => [slug, updated_at.toISOString()]),
    ).toEqual([["2026-11-05-upcoming", "2026-10-03T19:00:00.000Z"]]);
  });

  test("a second import with nothing new writes nothing", async () => {
    const db = await database();
    await importInto(db);
    const done = planned((await importInto(db)).result);
    expect(done).toMatchObject({ changes: [], written: 0 });
  });

  test("a dry run plans the same import and writes nothing", async () => {
    const db = await database();
    const before = await stored(db);
    const done = planned(
      (await importInto(db, undefined, { dryRun: true })).result,
    );
    expect(done.written).toBeNull();
    expect(done.changes.map(({ slug }) => slug)).toEqual([
      "2026-11-05-upcoming",
    ]);
    expect(await stored(db)).toEqual(before);
    expect(formatDescriptions(done)).toBe(
      [
        "Asked Luma about 2 published events; 0 not shown to us.",
        "Would change 1 event (dry run: nothing written).",
        "",
        "2026-11-05-upcoming (evt-upcoming)",
        "  description: none",
        '             → "Soon An evening of talks about the web, in the East Cut. Doors at 6." (100 chars)',
        "  summary: null",
        '         → "An evening of talks about the web, in the East Cut. Doors at 6."',
      ].join("\n"),
    );
  });

  test("follows Luma: an edited description replaces the stored one, a removed one clears it", async () => {
    const db = await database();
    await importInto(db);
    await importInto(db, {
      "evt-react": [answer("evt-react", "")],
      "evt-upcoming": [
        answer(
          "evt-upcoming",
          "Rescheduled to a later evening, in the same place.",
        ),
      ],
    });
    expect(
      (await stored(db)).map(({ luma_summary, luma_description }) => [
        luma_summary,
        luma_description,
      ]),
    ).toEqual([
      [null, null],
      [null, null],
      [
        "Rescheduled to a later evening, in the same place.",
        "<p>Rescheduled to a later evening, in the same place.</p>\n",
      ],
    ]);
  });

  test("an event Luma no longer shows keeps its description", async () => {
    const db = await database();
    const done = planned(
      (
        await importInto(db, {
          "evt-react": [{ status: 403 }],
          "evt-upcoming": [{ status: 404 }],
        })
      ).result,
    );
    expect(done).toMatchObject({
      unavailable: ["evt-upcoming", "evt-react"],
      changes: [],
      written: 0,
    });
    expect((await stored(db))[0]?.luma_summary).toBe(summary);
  });

  test("a failure asking about any event writes nothing", async () => {
    const db = await database();
    const before = await stored(db);
    await expect(
      importInto(db, {
        "evt-react": [{ status: 401 }],
        "evt-upcoming": [answer("evt-upcoming", upcoming)],
      }),
    ).rejects.toThrow();
    expect(await stored(db)).toEqual(before);
  });

  test("asks about events without a description first, then the latest", async () => {
    const db = await database();
    const { requests } = await importInto(db, undefined, { maxEvents: 1 });
    expect(
      requests.map(({ url }) => new URL(url).searchParams.get("event_id")),
    ).toEqual(["evt-upcoming"]);
    await db.exec(
      `UPDATE events SET luma_description = '<p>x</p>' WHERE luma_event_id = 'evt-upcoming';
       UPDATE events SET end_date = '2026-12-01T00:00:00Z' WHERE luma_event_id = 'evt-react'`,
    );
    const again = await importInto(db, undefined, { maxEvents: 1 });
    expect(
      again.requests.map(({ url }) =>
        new URL(url).searchParams.get("event_id"),
      ),
    ).toEqual(["evt-react"]);
  });
});
