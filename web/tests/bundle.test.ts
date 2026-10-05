import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  budgetProblems,
  bytesBySource,
  chunksOf,
  contributorOf,
  startupContributors,
} from "./support/bundle.ts";

/**
 * The bundle report the budget test prints: which modules a cold start
 * parses, and which sources they are made of, read from the source maps.
 * Held to a small bundle built here, with one module behind `import()`.
 */

const directory = await mkdtemp(join(tmpdir(), "bundle-report-"));
afterAll(() => rm(directory, { recursive: true, force: true }));

await Bun.write(
  join(directory, "src/worker.ts"),
  `import { greet } from "./greet.ts";
export default {
  async fetch(request: Request) {
    if (new URL(request.url).pathname === "/heavy") {
      const { heavy } = await import("./heavy.ts");
      return new Response(heavy());
    }
    return new Response(greet());
  },
};`,
);
await Bun.write(
  join(directory, "src/greet.ts"),
  `export const greet = () => "hello, " + ["a", "b", "c"].join("-");`,
);
await Bun.write(
  join(directory, "src/heavy.ts"),
  `export const heavy = () => ${JSON.stringify("x".repeat(4000))}.split("").reverse().join("");`,
);
const out = join(directory, "out");
const built = await Bun.build({
  entrypoints: [join(directory, "src/worker.ts")],
  outdir: out,
  splitting: true,
  sourcemap: "external",
  minify: true,
  naming: { entry: "worker.js", chunk: "[name]-[hash].js" },
});
if (!built.success) throw new AggregateError(built.logs, "build failed");

describe("chunksOf", () => {
  test("sorts the entry and what it imports apart from what loads on first use", async () => {
    const chunks = await chunksOf(out);
    expect(chunks.find((chunk) => chunk.file === "worker.js")?.startup).toBe(
      true,
    );
    const lazy = chunks.filter((chunk) => !chunk.startup);
    expect(lazy).toHaveLength(1);
    expect(lazy[0]?.file).toStartWith("heavy-");
    for (const chunk of chunks) expect(chunk.gzipped).toBeGreaterThan(0);
  });
});

describe("chunksOf, beside an earlier build", () => {
  test("counts only the modules the entry reaches", async () => {
    await Bun.write(join(out, "stale-0000.js"), "export const old = 1;");
    try {
      const files = (await chunksOf(out)).map((chunk) => chunk.file);
      expect(files).not.toContain("stale-0000.js");
    } finally {
      await rm(join(out, "stale-0000.js"));
    }
  });
});

describe("startupContributors", () => {
  test("names the sources a cold start parses, and none that load later", async () => {
    const names = (await startupContributors(out)).map(
      (contributor) => contributor.name,
    );
    expect(names.some((name) => name.endsWith("greet.ts"))).toBe(true);
    expect(names.some((name) => name.endsWith("heavy.ts"))).toBe(false);
  });
});

describe("bytesBySource", () => {
  test("gives every byte of the code to a source or to the bundler", async () => {
    const code = await Bun.file(join(out, "worker.js")).text();
    const map = await Bun.file(join(out, "worker.js.map")).json();
    const pieces = bytesBySource(code, map);
    const total = [...pieces.values()]
      .flat()
      .reduce((sum, text) => sum + text.length, 0);
    expect(total).toBe(code.replaceAll("\n", "").length);
  });
});

describe("contributorOf", () => {
  test.each([
    [
      "../../node_modules/.bun/effect@4.0.0/node_modules/effect/dist/Schema.js",
      "effect/Schema",
    ],
    [
      "../../node_modules/.bun/@modelcontextprotocol+server@2.2.0/node_modules/@modelcontextprotocol/server/dist/index.js",
      "@modelcontextprotocol/server",
    ],
    ["../../node_modules/zod/v4/core/schemas.js", "zod"],
    ["../../../src/pages/event.tsx", "src/pages/event.tsx"],
    ["../../../../core/src/home.ts", "core/src/home.ts"],
  ])("%s is %s", (source, name) => {
    expect(contributorOf(source)).toBe(name);
  });
});

describe("budgetProblems", () => {
  test("is nothing within budget", async () => {
    expect(
      await budgetProblems(out, { startup: 1_000_000, lazy: 1_000_000 }),
    ).toBeUndefined();
  });

  test("says what is over, and what the cold start is made of", async () => {
    const problems = await budgetProblems(out, { startup: 10, lazy: 10 });
    expect(problems).toMatch(
      /^Cold-start modules weigh \d+ bytes gzipped, over 10\./,
    );
    expect(problems).toMatch(
      /heavy-[^,]+\.js, loaded on first use, weighs \d+ bytes gzipped, over 10\./,
    );
    expect(problems).toContain("What the cold start is made of:");
    expect(problems).toMatch(/KB gz .*greet\.ts/);
  });
});
