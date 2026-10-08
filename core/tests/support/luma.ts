import { Clock, ConfigProvider, Effect, Fiber, Layer } from "effect";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";

/**
 * Luma, faked: an `HttpClient` that answers from fixtures and records what it
 * was asked. No test reaches the network.
 */

/** tests/fixtures/luma/<name>: a feed written in the shape Luma serves. */
export const fixture = (name: string): Promise<string> =>
  Bun.file(new URL(`../fixtures/luma/${name}`, import.meta.url)).text();

/** What the fake answers one request with. */
export type Reply =
  | {
      readonly status?: number;
      /** Text, or bytes, as an image is served. */
      readonly body?: string | Uint8Array;
      readonly headers?: Record<string, string>;
    }
  /** The connection fails. */
  | "drop"
  /** No answer, ever. */
  | "hang";

export interface Request {
  readonly url: string;
  readonly method: string;
  /** Its body as text, for a JSON or byte body; undefined without one. */
  readonly body: string | undefined;
  readonly accept: string | undefined;
  /** The Luma API key it carried, if any. */
  readonly apiKey: string | undefined;
  /** Its Authorization header, if any. */
  readonly authorization: string | undefined;
  /** The Clock's time when it was sent. */
  readonly at: number;
}

/**
 * Answers request n with `replies[n]`, and every request after the last reply
 * with the last one.
 */
export function fakeLuma(replies: ReadonlyArray<Reply>) {
  return fakeLumaBy(() => "", { "": replies });
}

/**
 * Answers each request from the replies listed under its `key`, in turn:
 * the nth request with that key gets the nth reply, and every one after the
 * last gets the last. Requests sent at once are answered by what they ask
 * for, not by the order they arrive in.
 */
export function fakeLumaBy(
  key: (url: URL) => string,
  replies: Readonly<Record<string, ReadonlyArray<Reply>>>,
) {
  const requests: Array<Request> = [];
  const asked = new Map<string, number>();
  const client = HttpClient.make((request, url) =>
    Effect.gen(function* () {
      requests.push({
        url: url.href,
        method: request.method,
        body:
          request.body._tag === "Uint8Array"
            ? new TextDecoder().decode(request.body.body)
            : undefined,
        accept: request.headers["accept"],
        apiKey: request.headers["x-luma-api-key"],
        authorization: request.headers["authorization"],
        at: yield* Clock.currentTimeMillis,
      });
      const which = key(url);
      const listed = replies[which] ?? [];
      const n = (asked.get(which) ?? 0) + 1;
      asked.set(which, n);
      const reply = listed[Math.min(n, listed.length) - 1];
      if (reply === undefined)
        throw new Error(`fakeLuma needs a reply for "${which}".`);
      if (reply === "hang") return yield* Effect.never;
      if (reply === "drop") {
        return yield* new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({
            request,
            description: "connection reset",
          }),
        });
      }
      return HttpClientResponse.fromWeb(
        request,
        new Response(reply.body ?? "", {
          status: reply.status ?? 200,
          headers: reply.headers ?? {},
        }),
      );
    }),
  );
  return { layer: Layer.succeed(HttpClient.HttpClient, client), requests };
}

/** Configuration from `env` alone, never the machine's environment. */
export const configFrom = (env: Record<string, string> = {}) =>
  Layer.succeed(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env }));

/**
 * Real time one stretch of a test's own work may take, with nothing waiting
 * on the clock, before settle gives up on it.
 */
const realWorkLimitMillis = 30_000;

/**
 * Runs `effect` to its end under a TestClock, moving the clock a second at a
 * time so that its retries' sleeps and timeouts elapse. Gives up after ten
 * minutes of test time.
 *
 * The clock moves only while something waits on it. While nothing does, the
 * effect is doing real work (a query, reading a response body), and the
 * clock stands still until that is done, however long it takes in real time
 * (up to {@link realWorkLimitMillis}): a busy machine never turns a slow
 * query into ten minutes of retries. Before each second, real work queued
 * since gets its turn.
 *
 * What it can't see is real work running beside a sleep that is pending,
 * such as a slow query under a timeout: the clock moves for the sleep. The
 * code these tests drive never does that: its timeouts wrap requests, and
 * the fakes answer them in memory (see tests/settle.test.ts).
 */
export const settle = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    let waiting = 0;
    const counting: Clock.Clock = {
      currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
      currentTimeMillis: clock.currentTimeMillis,
      currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
      currentTimeNanos: clock.currentTimeNanos,
      monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
      monotonicTimeNanos: clock.monotonicTimeNanos,
      sleep: (duration) =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            waiting++;
          }),
          () => clock.sleep(duration),
          () =>
            Effect.sync(() => {
              waiting--;
            }),
        ),
    };
    const fiber = yield* Effect.forkChild(
      Effect.provideService(effect, Clock.Clock, counting),
    );
    // When the current stretch of real work began; undefined while
    // something waits on the clock.
    let realWork: number | undefined;
    let seconds = 0;
    for (;;) {
      yield* Effect.promise(() => Bun.sleep(0));
      if (fiber.pollUnsafe() !== undefined) return yield* Fiber.join(fiber);
      if (waiting === 0) {
        realWork ??= Date.now();
        if (Date.now() - realWork > realWorkLimitMillis) {
          return yield* Effect.die(
            new Error("Did not settle: its own work took over 30 seconds."),
          );
        }
        yield* Effect.promise(() => Bun.sleep(1));
        continue;
      }
      realWork = undefined;
      if (seconds === 600) {
        return yield* Effect.die(new Error("Did not settle in ten minutes."));
      }
      yield* TestClock.adjust("1 second");
      seconds++;
    }
  });
