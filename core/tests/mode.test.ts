import { describe, expect, test } from "bun:test";
import { DateTime } from "effect";
import { daytimeStartsAt, eventMode, eveningStartsAt } from "../src/mode.ts";

/** One mode per event: Night for evenings, Paper for daytime events. */

const at = (iso: string) => DateTime.makeUnsafe(iso);

describe("eventMode", () => {
  test("daytime runs from 5 AM to 4 PM in San Francisco", () => {
    expect([daytimeStartsAt, eveningStartsAt]).toEqual([5, 16]);
  });

  test.each([
    // Our evenings: 5 and 5:30 PM, 8 PM for an after-party.
    ["2026-10-01T00:30:00Z", "Wed 5:30 PM PDT", "night"],
    ["2024-12-04T01:00:00Z", "Tue 5:00 PM PST", "night"],
    ["2025-11-05T04:00:00Z", "Tue 8:00 PM PST", "night"],
    // Hackathons and demo days start in the morning.
    ["2025-04-26T17:30:00Z", "Sat 10:30 AM PDT", "paper"],
    ["2024-10-05T18:30:00Z", "Sat 11:30 AM PDT", "paper"],
    ["2026-04-09T15:30:00Z", "Thu 8:30 AM PDT", "paper"],
    // An evening hackathon is an evening.
    ["2025-09-24T00:00:00Z", "Tue 5:00 PM PDT", "night"],
    // The edges: 5 AM and 4 PM are each the first minute of their mode.
    ["2026-01-15T12:59:59Z", "4:59:59 AM PST", "night"],
    ["2026-01-15T13:00:00Z", "5:00 AM PST", "paper"],
    ["2026-07-15T22:59:59Z", "3:59:59 PM PDT", "paper"],
    ["2026-07-15T23:00:00Z", "4:00 PM PDT", "night"],
    // Midnight, and the small hours, are still the evening.
    ["2026-07-16T07:00:00Z", "12:00 AM PDT", "night"],
    ["2026-07-16T11:30:00Z", "4:30 AM PDT", "night"],
  ] as const)("%s (%s) is %s", (iso, _, mode) => {
    expect(eventMode(at(iso))).toBe(mode);
  });

  test("reads San Francisco's clock, not UTC's, across daylight saving", () => {
    // 3 PM in San Francisco both times: 23:00 UTC in winter, 22:00 in summer.
    expect(eventMode(at("2026-03-07T23:00:00Z"))).toBe("paper");
    expect(eventMode(at("2026-03-09T22:00:00Z"))).toBe("paper");
    // 4 PM both times.
    expect(eventMode(at("2026-03-08T00:00:00Z"))).toBe("night");
    expect(eventMode(at("2026-03-09T23:00:00Z"))).toBe("night");
  });
});
