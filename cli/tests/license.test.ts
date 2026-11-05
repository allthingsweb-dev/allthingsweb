import { expect, test } from "bun:test";

/**
 * The CLI is MIT, as the repository is. Its package carries its own copy of
 * the repository's LICENSE, because npm packs only what is in cli/.
 */

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

test("the package says MIT and ships the repository's LICENSE, word for word", async () => {
  const pkg = JSON.parse(await read("../package.json")) as { license?: string };
  expect(pkg.license).toBe("MIT");
  const own = await read("../LICENSE");
  expect(own).toBe(await read("../../LICENSE"));
  expect(own).toStartWith("MIT License\n");
});
