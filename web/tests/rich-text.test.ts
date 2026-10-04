import { describe, expect } from "bun:test";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import {
  corpus,
  expectedSanitized,
  unsafeParts,
} from "allthings-core/tests/support/rich-text.ts";
import * as Effect from "effect/Effect";
import { compatibility } from "../src/compatibility.ts";

/**
 * The talk-description sanitizer in workerd, whose HTMLRewriter the Worker
 * uses, held to what core's tests hold it to in Bun: the app's output for
 * every case in the corpus but the listed divergences, and nothing unsafe.
 */

const Stack = Alchemy.Stack(
  "allthings-web-rich-text-test",
  { providers: Cloudflare.providers(), state: Alchemy.inMemoryState() },
  Effect.gen(function* () {
    const { url } = yield* Cloudflare.Worker("RichText", {
      main: new URL("./support/rich-text-worker.ts", import.meta.url).pathname,
      compatibility,
    });
    return { RichText: url };
  }),
);

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});
const workers = beforeAll(deploy(Stack));
afterAll(destroy(Stack));

/** `html`, sanitized by the Worker. */
const sanitized = (html: string) =>
  Effect.flatMap(workers, (outputs) =>
    Effect.promise(async () => {
      const url = outputs["RichText"];
      if (typeof url !== "string" || !url.startsWith("http://localhost")) {
        throw new Error(`RichText is not running locally: ${String(url)}`);
      }
      const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify(html),
      });
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      if (typeof body !== "string") throw new Error("The Worker sent no HTML");
      return body;
    }),
  );

describe("sanitizeRichText in workerd", () => {
  for (const html of corpus) {
    test(
      JSON.stringify(html),
      Effect.map(sanitized(html), (output) => {
        expect(output).toBe(expectedSanitized(html));
        expect(unsafeParts(output)).toEqual([]);
      }),
    );
  }
});
