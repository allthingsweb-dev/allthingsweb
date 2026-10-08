import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Effect, Layer } from "effect";
import { Planning } from "../src/planning/planning.ts";
import { type CollabFacts, collabChecks } from "../src/readiness/collab.ts";
import { formatReadiness } from "../src/readiness/format.ts";
import { Readiness } from "../src/readiness/readiness.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * What collaborating on a draft still needs, as readiness reports it
 * (src/readiness/collab.ts): advice, never a blocker. Everyone and every
 * row here is made up in this file.
 */

const none: CollabFacts = { rounds: [], logistics: [], tasks: [] };
const today = "2026-10-21";

const round = (over: Partial<CollabFacts["rounds"][number]> = {}) => ({
  position: 5,
  title: "AI",
  hosts: 1,
  handedIn: "2026-10-19 18:00:00+00",
  decision: "accepted",
  due: "2026-10-20",
  ...over,
});

const kinds = (checks: ReadonlyArray<{ kind: string; level: string }>) =>
  checks.map((check) => `${check.level} ${check.kind}`);

describe("collabChecks", () => {
  test("nothing to say about an evening without collaboration, or one that's all in", () => {
    expect(collabChecks(none, today)).toEqual([]);
    expect(
      collabChecks(
        {
          rounds: [round()],
          logistics: [
            { position: 1, label: "HDMI", answer: "yes", decision: "accepted" },
          ],
          tasks: [
            {
              title: "Drafts",
              dueOn: "2026-10-20",
              done: true,
              for: "round_host",
            },
          ],
        },
        today,
      ),
    ).toEqual([]);
  });

  test("a round without a host, not handed in, or not accepted", () => {
    const checks = collabChecks(
      {
        ...none,
        rounds: [
          round({ position: 1, title: "JS", hosts: 0 }),
          round({
            position: 2,
            title: "Sandboxes",
            handedIn: null,
            decision: null,
          }),
          round({
            position: 3,
            title: "Databases",
            handedIn: null,
            decision: null,
            due: "2026-10-30",
          }),
          round({ decision: null }),
          round({
            position: 6,
            title: "Agents",
            decision: "changes_requested",
          }),
        ],
      },
      today,
    );
    expect(checks.map((check) => check.message)).toEqual([
      "No one is invited to host round 1, JS: bun run collab invite … --role round_host --round 1.",
      "round 2, Sandboxes isn't handed in, and was due 2026-10-20.",
      "round 3, Databases isn't handed in yet (due 2026-10-30).",
      "round 5, AI is handed in and not reviewed: bun run collab submissions, then collab review round.",
      "round 6, Agents: its latest save is waiting on changes.",
    ]);
    expect(checks.every((check) => check.level === "advice")).toBe(true);
  });

  test("what the venue hasn't confirmed, and tasks past their date", () => {
    const checks = collabChecks(
      {
        rounds: [],
        logistics: [
          { position: 1, label: "HDMI", answer: null, decision: null },
          { position: 2, label: "Floor", answer: "unsure", decision: null },
          { position: 3, label: "Mics", answer: "yes", decision: null },
        ],
        tasks: [
          {
            title: "Confirm the room",
            dueOn: "2026-10-12",
            done: false,
            for: "venue",
          },
          {
            title: "Slides",
            dueOn: "2026-10-26",
            done: false,
            for: "everyone",
          },
          { title: "Drafts", dueOn: null, done: false, for: "round_host" },
        ],
      },
      today,
    );
    expect(kinds(checks)).toEqual([
      "advice logistics",
      "advice logistics",
      "advice logistics",
      "advice task-overdue",
    ]);
    expect(checks.map((check) => check.message)).toEqual([
      'The venue hasn\'t answered "HDMI".',
      'The venue answered "Floor": unsure.',
      'The venue confirmed "Mics": not reviewed yet.',
      '"Confirm the room" (for venue) was due 2026-10-12.',
    ]);
  });
});

let db: PGlite;
beforeEach(async () => {
  db = await seededDatabase();
});
afterEach(() => db.close());

const report = () =>
  Effect.runPromise(
    Readiness.use((r) =>
      r.report({ _tag: "Event", slug: "2026-09-01-draft-night" }),
    ).pipe(
      Effect.provide(
        Readiness.layer.pipe(
          Layer.provideMerge(Planning.layer),
          Layer.provideMerge(sqlLayer(db)),
          Layer.provideMerge(clockLayer),
        ),
      ),
    ),
  );

describe("the report", () => {
  test("lists what collaboration still needs as advice, and blocks nothing more", async () => {
    await db.exec(`UPDATE events SET start_date = '2026-10-28T00:30:00Z', end_date = '2026-10-28T03:30:00Z'
      WHERE slug = '2026-09-01-draft-night'`);
    const before = await report();
    await db.exec(`
      INSERT INTO planning.rounds (id, event_id, position, title)
        SELECT 'f1000000-0000-4000-8000-000000000005', id, 5, 'AI' FROM events WHERE slug = '2026-09-01-draft-night';
      INSERT INTO planning.collaborators (event_id, email, name, role, round_id, invited_at, expires_at)
        SELECT id, 'simon@example.com', 'Simon', 'round_host', 'f1000000-0000-4000-8000-000000000005',
          now() - interval '1 day', now() + interval '30 days'
        FROM events WHERE slug = '2026-09-01-draft-night';
      INSERT INTO planning.tasks (event_id, title, due_on, role)
        SELECT id, 'First drafts of your 8 + 1', '2026-10-01', 'round_host' FROM events WHERE slug = '2026-09-01-draft-night';
      INSERT INTO planning.logistics_items (event_id, position, label)
        SELECT id, 1, 'Projector with HDMI' FROM events WHERE slug = '2026-09-01-draft-night';`);
    const after = await report();
    expect(after.ready).toBe(before.ready);
    const added = after.checks.slice(before.checks.length);
    expect(kinds(added)).toEqual([
      "advice round-handed-in",
      "advice logistics",
      "advice task-overdue",
    ]);
    expect(added[0]?.message).toBe(
      "round 5, AI isn't handed in, and was due 2026-10-01.",
    );
    expect(formatReadiness(after)).toContain(
      'The venue hasn\'t answered "Projector with HDMI".',
    );
  });
});
