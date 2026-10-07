import { describe, expect, test } from "bun:test";
import { DateTime, Effect } from "effect";
import { asOf } from "../src/clock.ts";
import { clockAt } from "./support/database.ts";

/** Every public read is as of the start of the current minute. */

const at = (iso: string) => DateTime.makeUnsafe(iso);
const readAt = (iso: string) =>
  Effect.runPromise(Effect.provide(asOf, clockAt(at(iso))));

describe("asOf", () => {
  test.each([
    ["2026-10-03T19:00:00.000Z", "2026-10-03T19:00:00.000Z"],
    ["2026-10-03T19:00:00.001Z", "2026-10-03T19:00:00.000Z"],
    ["2026-10-03T19:00:59.999Z", "2026-10-03T19:00:00.000Z"],
    ["2026-10-03T19:01:00.000Z", "2026-10-03T19:01:00.000Z"],
    // Across midnight and a change of clocks, minutes are UTC's.
    ["2026-11-01T08:59:59.999Z", "2026-11-01T08:59:00.000Z"],
  ])("at %s reads as of %s", async (now, expected) => {
    expect(DateTime.formatIso(await readAt(now))).toBe(expected);
  });

  test("is the same instant all minute, so the same query is the same query", async () => {
    const instants = await Promise.all(
      ["19:00:01.234", "19:00:30.000", "19:00:59.999"].map((time) =>
        readAt(`2026-10-03T${time}Z`),
      ),
    );
    expect(new Set(instants.map(DateTime.toEpochMillis)).size).toBe(1);
  });
});
