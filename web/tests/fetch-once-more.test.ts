import { afterEach, describe, expect, test } from "bun:test";
import { fetchOnceMore } from "../src/images/route.ts";

/**
 * fetchOnceMore (images/route.ts) against a stand-in `fetch`: each call
 * takes the next of `answers`, a response or a failure on the way.
 */
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const answering = (...answers: ReadonlyArray<Response | Error>) => {
  const calls: Array<string> = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(input instanceof Request ? input.url : input.toString());
    const next = answers[calls.length - 1];
    if (next === undefined) throw new Error("no more answers");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return calls;
};

const url = "https://media.example/events/a.jpg";

describe("fetchOnceMore", () => {
  test("fetches once more after a failure on the way, and answers with the second", async () => {
    const calls = answering(
      new TypeError("Network connection lost"),
      new Response("ok", { status: 200 }),
    );
    const response = await fetchOnceMore(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(calls).toEqual([url, url]);
  });

  test("fetches once more after a 5xx, whose body won't cancel", async () => {
    const broken = new Response(
      new ReadableStream({
        cancel() {
          throw new Error("the stream broke");
        },
      }),
      { status: 503 },
    );
    const calls = answering(broken, new Response("ok", { status: 200 }));
    expect((await fetchOnceMore(url)).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  test("takes any answer under 500 the first time, and gives up after the second", async () => {
    answering(new Response("", { status: 404 }));
    expect((await fetchOnceMore(url)).status).toBe(404);
    const calls = answering(
      new Response("", { status: 502 }),
      new Response("", { status: 503 }),
    );
    expect((await fetchOnceMore(url)).status).toBe(503);
    expect(calls).toHaveLength(2);
  });
});
