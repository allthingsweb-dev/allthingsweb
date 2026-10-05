import { describe, expect, test } from "bun:test";
import { programForHackathonFlag } from "../src/lib/event-program";

/**
 * The admin writers (scripts/functions.ts: create_event and update_event)
 * keep an event's program and hackathon flag together, as the database
 * requires.
 */

describe("programForHackathonFlag", () => {
  test("setting the flag makes the program hackathon", () => {
    expect(programForHackathonFlag(true, undefined)).toBe("hackathon");
    expect(programForHackathonFlag(true, "social")).toBe("hackathon");
  });

  test("clearing it on a hackathon makes it talks", () => {
    expect(programForHackathonFlag(false, "hackathon")).toBe("talks");
  });

  test("leaves any other program, or an untouched flag, be", () => {
    expect(programForHackathonFlag(false, "social")).toBeUndefined();
    expect(programForHackathonFlag(false, undefined)).toBeUndefined();
    expect(programForHackathonFlag(undefined, "hackathon")).toBeUndefined();
  });
});
