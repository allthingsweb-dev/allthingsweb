import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import * as TestClock from "effect/testing/TestClock";
import { settle } from "./support/luma.ts";

/**
 * settle moves the test clock only while something waits on it: real work
 * (a query, a file, a response body) is waited for in real time, however
 * slow the machine, and test time passes only for sleeps and timeouts.
 */

const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromiseExit(settle(effect).pipe(Effect.provide(TestClock.layer())));

/** Real work that takes `millis` of real time, as a slow query would. */
const realWork = (millis: number) =>
  Effect.promise(() => Bun.sleep(millis)).pipe(Effect.as("done"));

describe("settle", () => {
  test("waits for slow real work without moving the clock", async () => {
    const exit = await run(
      realWork(200).pipe(Effect.andThen(Effect.sleep("1 minute"))),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  test("lets a retry's sleep elapse in test time, not real time", async () => {
    const started = Date.now();
    const exit = await run(
      Effect.sleep("5 minutes").pipe(Effect.andThen(Effect.succeed("slept"))),
    );
    expect(exit).toEqual(Exit.succeed("slept"));
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  test("lets a timeout fire on something that never answers", async () => {
    const exit = await run(
      Effect.never.pipe(Effect.timeoutOption("30 seconds")),
    );
    expect(exit).toEqual(Exit.succeed(expect.anything()));
  });

  test("gives up after ten minutes of test time", async () => {
    const exit = await run(Effect.sleep("11 minutes"));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(exit)).toContain("Did not settle in ten minutes.");
  });
});
