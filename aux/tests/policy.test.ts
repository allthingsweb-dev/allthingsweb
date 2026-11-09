import { describe, expect, test } from "bun:test";
import {
  AddressLimiter,
  assertNoFlash,
  flash,
  guardLight,
  limits,
  Policy,
} from "../src/policy.ts";

const second = 1_000;
const minute = 60 * second;

const open = () => new Policy({ frozen: false });

describe("per-code light limits", () => {
  test("one change every 30 s", () => {
    const policy = open();
    expect(policy.admitGuestLight("a", 0)).toBeUndefined();
    expect(policy.admitGuestLight("a", 29 * second)).toEqual({
      code: "rate_limited",
      retryAfterSeconds: 1,
    });
    expect(policy.admitGuestLight("a", 10 * second)).toEqual({
      code: "rate_limited",
      retryAfterSeconds: 20,
    });
    expect(policy.admitGuestLight("a", 30 * second)).toBeUndefined();
  });

  test("at most 6 in any 10 minutes", () => {
    const policy = open();
    for (let i = 0; i < limits.lightWindowMax; i++) {
      expect(policy.admitGuestLight("a", i * 30 * second)).toBeUndefined();
    }
    // The 7th waits for the 1st to leave the window, not just 30 s.
    expect(policy.admitGuestLight("a", 180 * second)).toEqual({
      code: "rate_limited",
      retryAfterSeconds: 420,
    });
    expect(policy.view("a", 180 * second).cooldownSeconds).toBe(420);
    expect(policy.admitGuestLight("a", 10 * minute)).toBeUndefined();
  });

  test("codes are limited separately", () => {
    const policy = open();
    expect(policy.admitGuestLight("a", 0)).toBeUndefined();
    expect(policy.admitGuestLight("b", 3 * second)).toBeUndefined();
  });

  test("a refused change costs nothing", () => {
    const policy = open();
    expect(policy.admitGuestLight("a", 0)).toBeUndefined();
    expect(policy.admitGuestLight("b", 1 * second)).toMatchObject({
      code: "rate_limited",
    });
    expect(policy.view("b", 1 * second).cooldownSeconds).toBe(0);
  });

  test("the aux holder's cooldown is 10 s, with no 10-minute cap", () => {
    const policy = open();
    expect(policy.requestAux("a", 0)).toEqual({ position: 0 });
    for (let i = 0; i < 10; i++) {
      expect(policy.admitGuestLight("a", i * 10 * second)).toBeUndefined();
    }
    expect(policy.admitGuestLight("a", 95 * second)).toEqual({
      code: "rate_limited",
      retryAfterSeconds: 5,
    });
    // After the turn the window counts what the holder did.
    expect(policy.view("a", 6 * minute)).toMatchObject({
      holder: null,
      // Its last 6 changes ran from 40 s to 90 s: free 10 minutes after 40 s.
      cooldownSeconds: 280,
    });
  });

  test("aux_status, once every 5 s per code", () => {
    const policy = open();
    expect(policy.admitStatus("a", 0)).toBeUndefined();
    expect(policy.admitStatus("a", 4 * second)).toEqual({
      code: "rate_limited",
      retryAfterSeconds: 1,
    });
    expect(policy.admitStatus("b", 4 * second)).toBeUndefined();
    expect(policy.admitStatus("a", 5 * second)).toBeUndefined();
  });
});

describe("freeze", () => {
  test("starts frozen unless told otherwise", () => {
    expect(new Policy().frozen).toBe(true);
    expect(new Policy({ frozen: false }).frozen).toBe(false);
  });

  test("guests can't change the lights or the aux; status still answers", () => {
    const policy = new Policy();
    expect(policy.admitGuestLight("a", 0)).toEqual({ code: "frozen" });
    expect(policy.requestAux("a", 0)).toEqual({ code: "frozen" });
    expect(policy.passAux("a", 0)).toEqual({ code: "frozen" });
    expect(policy.admitStatus("a", 0)).toBeUndefined();
    expect(policy.view("a", 0).frozen).toBe(true);
  });

  test("the host still sets lights, within the flash guard", () => {
    const policy = new Policy();
    expect(policy.admitHostLight(0)).toBeUndefined();
    expect(policy.admitHostLight(1 * second)).toEqual({
      code: "rate_limited",
      retryAfterSeconds: 2,
    });
  });

  test("opening again lets guests back in", () => {
    const policy = new Policy();
    policy.freeze(false);
    expect(policy.admitGuestLight("a", 0)).toBeUndefined();
    policy.freeze(true);
    expect(policy.admitGuestLight("b", 10 * second)).toEqual({
      code: "frozen",
    });
  });
});

describe("aux turns", () => {
  test("first come first served, 5 minutes each", () => {
    const policy = open();
    expect(policy.requestAux("a", 0)).toEqual({ position: 0 });
    expect(policy.requestAux("b", 1 * second)).toEqual({ position: 1 });
    expect(policy.requestAux("c", 2 * second)).toEqual({ position: 2 });
    // Asking again keeps your place.
    expect(policy.requestAux("b", 3 * second)).toEqual({ position: 1 });
    expect(policy.requestAux("a", 3 * second)).toEqual({ position: 0 });

    expect(policy.view("b", 4 * minute)).toMatchObject({
      holder: "someone",
      position: 1,
      waiting: 2,
      turnEndsInSeconds: 60,
    });
    expect(policy.view("b", limits.turnMs)).toMatchObject({
      holder: "you",
      position: 0,
      waiting: 1,
      turnEndsInSeconds: 300,
    });
    expect(policy.view("a", limits.turnMs).position).toBeNull();
    expect(policy.view("c", 2 * limits.turnMs).holder).toBe("you");
    // With nobody waiting, a turn's end frees the aux.
    expect(policy.view("c", 3 * limits.turnMs).holder).toBeNull();
    expect(policy.requestAux("a", 3 * limits.turnMs)).toEqual({ position: 0 });
  });

  test("turns that ended while nobody called hand on in order", () => {
    const policy = open();
    policy.requestAux("a", 0);
    policy.requestAux("b", 0);
    policy.requestAux("c", 0);
    expect(policy.hostView(11 * minute)).toEqual({
      holder: "c",
      line: [],
      turnEndsInSeconds: 240,
      frozen: false,
    });
  });

  test("only the holder passes; the next turn starts then", () => {
    const policy = open();
    policy.requestAux("a", 0);
    policy.requestAux("b", 0);
    expect(policy.passAux("b", 1 * minute)).toEqual({ code: "not_holder" });
    expect(policy.passAux("a", 1 * minute)).toEqual({ passed: true });
    expect(policy.view("b", 1 * minute)).toMatchObject({
      holder: "you",
      turnEndsInSeconds: 300,
    });
    expect(policy.passAux("b", 2 * minute)).toEqual({ passed: false });
    expect(policy.view("b", 2 * minute).holder).toBeNull();
  });

  test("the host clears the line and the turn", () => {
    const policy = open();
    policy.requestAux("a", 0);
    policy.requestAux("b", 0);
    expect(policy.clearAux()).toBe(2);
    expect(policy.hostView(0)).toMatchObject({ holder: null, line: [] });
  });

  test("a revoked holder hands the aux on", () => {
    const policy = open();
    policy.requestAux("a", 0);
    policy.requestAux("b", 0);
    policy.requestAux("c", 0);
    policy.revoke("a", 1 * minute);
    expect(policy.hostView(1 * minute)).toMatchObject({
      holder: "b",
      line: ["c"],
      turnEndsInSeconds: 300,
    });
    policy.revoke("c", 1 * minute);
    expect(policy.hostView(1 * minute).line).toEqual([]);
  });
});

describe("flash guard", () => {
  test("one change every 3 s across the room, guests and host alike", () => {
    const policy = open();
    expect(policy.admitGuestLight("a", 0)).toBeUndefined();
    expect(policy.admitGuestLight("b", 2 * second)).toEqual({
      code: "rate_limited",
      retryAfterSeconds: 1,
    });
    expect(policy.admitHostLight(2_500)).toEqual({
      code: "rate_limited",
      retryAfterSeconds: 1,
    });
    expect(policy.admitGuestLight("b", flash.roomIntervalMs)).toBeUndefined();
    // So the room never changes more than once in any 3 s.
    expect(flash.roomIntervalMs).toBeGreaterThanOrEqual(3_000);
  });

  test("fades at least 1.5 s and keeps brightness within 25-80%", () => {
    expect(
      guardLight({ color: { mirek: 600 }, brightness: 100, transitionMs: 0 }),
    ).toEqual({ color: { mirek: 500 }, brightness: 80, transitionMs: 1_500 });
    expect(
      guardLight({
        color: { xy: [1.2, -1] },
        brightness: 5,
        transitionMs: 3_000,
      }),
    ).toEqual({ color: { xy: [1, 0] }, brightness: 25, transitionMs: 3_000 });
  });

  test("refuses numbers it can't trust", () => {
    expect(() =>
      guardLight({
        color: { mirek: 300 },
        brightness: Number.NaN,
        transitionMs: 2_000,
      }),
    ).toThrow();
    expect(() =>
      guardLight({
        color: { xy: [Number.POSITIVE_INFINITY, 0.3] },
        brightness: 50,
        transitionMs: 2_000,
      }),
    ).toThrow();
  });

  test("refuses bodies that blink, alert, animate or don't fade", () => {
    const fade = { dynamics: { duration: 1_500 } };
    expect(() => assertNoFlash({ on: { on: true }, ...fade })).not.toThrow();
    for (const body of [
      { ...fade, alert: { action: "breathe" } },
      { ...fade, signaling: { signal: "on_off", duration: 2_000 } },
      { ...fade, effects: { effect: "sparkle" } },
      { ...fade, effects_v2: { action: { effect: "candle" } } },
      { ...fade, timed_effects: { effect: "sunrise" } },
      { on: { on: true } },
      { dynamics: { duration: 1_499 } },
      { dynamics: { duration: 2_000, speed: 1 } },
      { dynamics: "fast" },
    ]) {
      expect(() => assertNoFlash(body)).toThrow();
    }
  });
});

describe("address limit", () => {
  test("counts each address in fixed windows", () => {
    const limiter = new AddressLimiter(3, minute);
    expect([0, 1, 2].map((t) => limiter.hit("x", t))).toEqual([0, 0, 0]);
    expect(limiter.hit("x", 10 * second)).toBe(50 * second);
    expect(limiter.hit("y", 10 * second)).toBe(0);
    expect(limiter.hit("x", minute)).toBe(0);
  });
});
