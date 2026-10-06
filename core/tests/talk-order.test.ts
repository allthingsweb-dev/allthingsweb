import { afterAll, expect, test } from "bun:test";
import { talkOrder } from "../migrations/0014_talk_order.ts";
import { seededDatabase } from "./support/database.ts";

/**
 * The talk-order migration's backfill: every talk already attached takes
 * its place in its evening by attach order (created_at, then the talk's id).
 */

const db = await seededDatabase();
afterAll(() => db.close());

test("places each evening's talks in the order they were attached, from 0", async () => {
  await db.exec(`UPDATE event_talks SET position = NULL`);
  const backfill = talkOrder.at(-1);
  if (backfill === undefined) throw new Error("no backfill statement");
  await db.exec(backfill);
  const { rows } = await db.query<{
    event_id: string;
    talk_id: string;
    position: number;
  }>(
    `SELECT event_id, talk_id, position FROM event_talks ORDER BY event_id, position`,
  );
  expect(
    rows
      .filter((row) => row.event_id === "e0000000-0000-4000-8000-000000000001")
      .map((row) => [row.talk_id, row.position]),
  ).toEqual([
    // Effect in production was attached first, Server components second.
    ["a0000000-0000-4000-8000-000000000002", 0],
    ["a0000000-0000-4000-8000-000000000001", 1],
  ]);
  // Every evening's places run 0, 1, 2… with no gaps or repeats.
  const byEvent = Map.groupBy(rows, (row) => row.event_id);
  for (const talks of byEvent.values()) {
    expect(talks.map((talk) => talk.position)).toEqual(
      talks.map((_, index) => index),
    );
  }
});
