import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Layer, Option } from "effect";
import {
  LumaApi,
  type LumaEventPeople,
  type LumaHost,
} from "../src/luma/api.ts";
import {
  type CompanyHostsOptions,
  LumaCompanyHosts,
  planCompanyHosts,
} from "../src/luma/company-hosts.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * The hourly sync's company hosts step (src/luma/company-hosts.ts): the plan
 * as a pure function, and the step against tests/seed.sql with Luma's API
 * faked. No test reaches Luma.
 */

const host = (lumaUserId: string, name: string | null = null): LumaHost => ({
  lumaUserId,
  name,
  avatarUrl: null,
});

const people = (
  lumaEventId: string,
  hosts: ReadonlyArray<LumaHost>,
): LumaEventPeople => ({
  lumaEventId,
  managed: true,
  hosts,
  guestCount: null,
  checkedInCount: null,
});

describe("planCompanyHosts", () => {
  const evening = { eventId: "e1", slug: "night", lumaEventId: "evt-1" };
  const acme = { id: "c1", name: "Acme", lumaUserId: "usr-Acme1" };
  const globex = { id: "c2", name: "Globex", lumaUserId: "usr-Globex1" };

  test("attaches each company on record once, in Luma's order, and reports accounts no one holds", () => {
    const plan = planCompanyHosts(
      [
        {
          evening,
          people: people("evt-1", [
            host("usr-Globex1", "Globex"),
            host("usr-Ada1", "Ada"),
            host("usr-Stranger1", "Stranger"),
            host("usr-Acme1", "Acme"),
            host("usr-Globex1", "Globex"),
          ]),
        },
      ],
      [acme, globex],
      new Set(["usr-Ada1"]),
      new Set(),
    );
    expect(plan).toEqual({
      attach: [
        { eventId: "e1", slug: "night", companyId: "c2", company: "Globex" },
        { eventId: "e1", slug: "night", companyId: "c1", company: "Acme" },
      ],
      unknown: [
        { slug: "night", lumaUserId: "usr-Stranger1", name: "Stranger" },
      ],
    });
  });

  test("leaves out a company already attached, and makes no company of an unknown account", () => {
    const plan = planCompanyHosts(
      [
        {
          evening,
          people: people("evt-1", [
            host("usr-Acme1", "Acme"),
            host("usr-Initech1", "Initech"),
          ]),
        },
      ],
      [acme],
      new Set(),
      new Set(["e1 c1"]),
    );
    expect(plan.attach).toEqual([]);
    expect(plan.unknown).toEqual([
      { slug: "night", lumaUserId: "usr-Initech1", name: "Initech" },
    ]);
  });
});

describe("LumaCompanyHosts", () => {
  let db: PGlite;
  const asked: Array<string> = [];

  beforeEach(async () => {
    asked.length = 0;
    db = await seededDatabase();
    // Acme's Luma account is on record, and Ada's is her profile's.
    await db.exec(`
      UPDATE sponsors SET luma_user_id = 'usr-Acme1'
        WHERE id = 'c0000000-0000-4000-8000-000000000001';
      UPDATE profiles SET luma_user_id = 'usr-Ada1'
        WHERE id = 'b0000000-0000-4000-8000-000000000001';
    `);
  });
  afterEach(() => db.close());

  /** Luma's API, faked: each event `shown` lists hosts Acme, Ada and a stranger. */
  const api = (shown: boolean, key = true) =>
    Layer.succeed(
      LumaApi,
      LumaApi.of({
        eventPeople: key
          ? Option.some((lumaEventId: string) => {
              asked.push(lumaEventId);
              return Effect.succeed(
                shown
                  ? Option.some(
                      people(lumaEventId, [
                        host("usr-Acme1", "Acme"),
                        host("usr-Ada1", "Ada Lovelace"),
                        host("usr-Stranger1", "Stranger"),
                      ]),
                    )
                  : Option.none(),
              );
            })
          : Option.none(),
        eventVenue: Option.none(),
        eventDetails: Option.none(),
        eventDescription: Option.none(),
      }),
    );

  const run = (
    options: Partial<CompanyHostsOptions> = {},
    { shown = true, key = true } = {},
  ) =>
    Effect.runPromise(
      LumaCompanyHosts.use((step) =>
        step.run({ dryRun: false, within: "7 days", ...options }),
      ).pipe(
        Effect.provide(
          LumaCompanyHosts.layer.pipe(
            Layer.provide(api(shown, key)),
            Layer.provideMerge(sqlLayer(db)),
            Layer.provideMerge(clockLayer),
          ),
        ),
      ),
    );

  const attachedTo = async (eventId: string) =>
    (
      await db.query<{ name: string }>(
        `SELECT s.name FROM event_sponsors es JOIN sponsors s ON s.id = es.sponsor_id
          WHERE es.event_id = $1 ORDER BY s.name`,
        [eventId],
      )
    ).rows.map((row) => row.name);

  const upcoming = "e0000000-0000-4000-8000-000000000004";

  test("asks about published evenings with a Luma page that ended within the window, and attaches the companies on record", async () => {
    const result = await run();
    // The upcoming meetup alone: React at Acme ended in August, the draft
    // and the evenings without a Luma page aren't asked about.
    expect(asked).toEqual(["evt with space"]);
    expect(result).toEqual({
      _tag: "Planned",
      asked: 1,
      plan: {
        attach: [
          {
            eventId: upcoming,
            slug: "2026-11-05-upcoming",
            companyId: "c0000000-0000-4000-8000-000000000001",
            company: "Acme",
          },
        ],
        unknown: [
          {
            slug: "2026-11-05-upcoming",
            lumaUserId: "usr-Stranger1",
            name: "Stranger",
          },
        ],
      },
      unavailable: [],
      written: 1,
    });
    expect(await attachedTo(upcoming)).toEqual(["Acme"]);
    // No company was made of the stranger's account.
    expect(
      (await db.query(`SELECT 1 FROM sponsors WHERE name = 'Stranger'`)).rows,
    ).toEqual([]);
  });

  test("writes nothing the second time, and leaves a company attached before as it was", async () => {
    await run();
    const again = await run();
    expect(again).toMatchObject({ plan: { attach: [] }, written: 0 });
    // React at Acme already has Acme (and Globex) from an organizer.
    const wide = await run({ within: "3650 days" });
    expect(wide).toMatchObject({ asked: 2, plan: { attach: [] }, written: 0 });
    expect(await attachedTo("e0000000-0000-4000-8000-000000000001")).toEqual([
      "Acme",
      "Globex",
    ]);
  });

  test("a dry run plans the same and writes nothing", async () => {
    const result = await run({ dryRun: true });
    expect(result).toMatchObject({
      plan: { attach: [{ company: "Acme" }] },
      written: null,
    });
    expect(await attachedTo(upcoming)).toEqual([]);
  });

  test("asks about at most maxEvents evenings, the latest to start first", async () => {
    await run({ within: "3650 days", maxEvents: 1 });
    expect(asked).toEqual(["evt with space"]);
  });

  test("lists an evening Luma doesn't show us as unavailable, and attaches nothing for it", async () => {
    const result = await run({}, { shown: false });
    expect(result).toMatchObject({
      unavailable: ["evt with space"],
      plan: { attach: [], unknown: [] },
      written: 0,
    });
  });

  test("does nothing without LUMA_API_KEY", async () => {
    expect(await run({}, { key: false })).toEqual({
      _tag: "Skipped",
      reason: "LUMA_API_KEY is not set",
    });
  });
});
