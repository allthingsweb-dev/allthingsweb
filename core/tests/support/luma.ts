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
      readonly body?: string;
      readonly headers?: Record<string, string>;
    }
  /** The connection fails. */
  | "drop"
  /** No answer, ever. */
  | "hang";

export interface Request {
  readonly url: string;
  readonly accept: string | undefined;
  /** The Luma API key it carried, if any. */
  readonly apiKey: string | undefined;
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
        accept: request.headers["accept"],
        apiKey: request.headers["x-luma-api-key"],
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
 * Runs `effect` to its end under a TestClock, moving the clock a second at a
 * time so that its retries' sleeps and timeouts elapse, and letting real work
 * (such as reading a response body) finish in between. Gives up after ten
 * minutes of test time.
 */
export const settle = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect);
    for (let second = 0; second <= 600; second++) {
      yield* Effect.promise(() => Bun.sleep(0));
      if (fiber.pollUnsafe() !== undefined) return yield* Fiber.join(fiber);
      yield* TestClock.adjust("1 second");
    }
    return yield* Effect.die(new Error("Did not settle in ten minutes."));
  });
