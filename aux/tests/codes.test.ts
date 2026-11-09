import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import {
  CodeBook,
  newCode,
  normalizeCode,
  withFileLock,
} from "../src/codes.ts";

const directory = mkdtempSync(join(import.meta.dir, ".tmp-codes-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("guest codes", () => {
  test("are 10 base32 characters, 50 random bits, in two groups", () => {
    const code = newCode();
    expect(code).toMatch(/^[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}$/);
    expect(new Set(Array.from({ length: 200 }, () => newCode())).size).toBe(
      200,
    );
  });

  test("forgive case, spaces, hyphens and look-alike letters", () => {
    expect(normalizeCode(" AB1CD-EF0GH ")).toBe("ab1cdef0gh");
    expect(normalizeCode("abicd efogh")).toBe("ab1cdef0gh");
    expect(normalizeCode("abLcdefOgh")).toBe("ab1cdef0gh");
    expect(normalizeCode("abcdefgh")).toBeUndefined();
    expect(normalizeCode("abcdefghuu")).toBeUndefined();
    expect(normalizeCode("abcde fghjk!")).toBeUndefined();
  });

  test("are stored as salted hashes only, readable by the owner alone", () => {
    const path = join(directory, "codes.json");
    const book = CodeBook.load(path, { create: true });
    const codes = book.generate(5);
    const stored = readFileSync(path, "utf8");
    for (const code of codes) {
      expect(stored).not.toContain(code);
      expect(stored).not.toContain(normalizeCode(code) ?? "");
    }
    expect(statSync(path).mode & 0o777).toBe(0o600);
    // Reloaded, the book still knows them.
    const reloaded = CodeBook.load(path);
    expect(reloaded.size).toBe(5);
    for (const code of codes)
      expect(reloaded.identify(code)).toMatch(/^[0-9a-f]{12}$/);
  });

  test("the same code hashes differently under another salt", () => {
    const fixed = () => new Uint8Array(10).fill(7);
    const [a] = CodeBook.empty().generate(1, fixed);
    const other = CodeBook.empty();
    expect(other.identify(a ?? "")).toBeUndefined();
  });

  test("an unknown or malformed code names nobody", () => {
    const book = CodeBook.empty();
    book.generate(3);
    expect(book.identify("00000-00000")).toBeUndefined();
    expect(book.identify("")).toBeUndefined();
    expect(book.identify("x".repeat(10_000))).toBeUndefined();
  });

  test("revoking by id prefix, persisted", () => {
    const path = join(directory, "revoke.json");
    const book = CodeBook.load(path, { create: true });
    const [code = ""] = book.generate(2);
    const id = book.identify(code) ?? "";
    expect(book.revoke("zz")).toEqual({ error: "unknown_code" });
    expect(book.revoke("12345")).toEqual({ error: "unknown_code" });
    expect(book.revoke(id.slice(0, 8))).toEqual({ id });
    expect(book.identify(code)).toBeUndefined();
    expect(CodeBook.load(path).identify(code)).toBeUndefined();
  });

  test("serving without a codes file says how to make one", () => {
    expect(() => CodeBook.load(join(directory, "missing.json"))).toThrow(
      "--generate",
    );
  });

  test("a revoke keeps codes another process generated since the hub loaded", () => {
    const path = join(directory, "merge.json");
    const hub = CodeBook.load(path, { create: true });
    const [first] = hub.generate(2);
    const added = CodeBook.load(path).generate(5);
    const id = hub.identify(first ?? "");
    expect(id).toBeDefined();
    expect(hub.revoke(id ?? "")).toEqual({ id: id ?? "" });
    const after = CodeBook.load(path);
    expect(after.size).toBe(7);
    expect(after.identify(first ?? "")).toBeUndefined();
    for (const code of added) expect(after.identify(code)).toBeDefined();
  });

  /** Starts tests/lock-worker.ts in its own process. */
  function worker(...args: string[]) {
    return Bun.spawn(
      [process.execPath, join(import.meta.dir, "lock-worker.ts"), ...args],
      { stdout: "pipe", stderr: "pipe" },
    );
  }

  /** A second process holding the codes lock, once it says so. */
  async function holder(path: string) {
    const child = worker("hold", path);
    const reader = child.stdout.getReader();
    let said = "";
    while (!said.includes("locked")) {
      const { value, done } = await reader.read();
      if (done) {
        throw new Error(
          `The lock holder exited: ${await new Response(child.stderr).text()}`,
        );
      }
      said += new TextDecoder().decode(value);
    }
    return child;
  }

  test("waits for another process's lock, then gives up and leaves it held", async () => {
    const path = join(directory, "busy.json");
    const child = await holder(path);
    try {
      const started = Date.now();
      expect(() => withFileLock(path, () => 0, 300)).toThrow(
        "is held by another process",
      );
      expect(Date.now() - started).toBeGreaterThanOrEqual(290);
      const book = CodeBook.load(path, { create: true });
      expect(() => book.generate(1)).toThrow("is held by another process");
      expect(existsSync(path)).toBe(false);
    } finally {
      child.kill(9);
      await child.exited;
    }
  }, 10_000);

  test("a crashed holder's lock is released, with nothing to reclaim", async () => {
    const path = join(directory, "crashed.json");
    const child = await holder(path);
    child.kill(9);
    await child.exited;
    expect(withFileLock(path, () => "mine", 1_000)).toBe("mine");
    expect(CodeBook.load(path, { create: true }).generate(1)).toHaveLength(1);
  });

  test("processes writing at once never lose a code", async () => {
    const path = join(directory, "concurrent.json");
    const children = Array.from({ length: 4 }, () =>
      worker("generate", path, "10"),
    );
    const printed = await Promise.all(
      children.map(async (child) => {
        const [out, exit] = await Promise.all([
          new Response(child.stdout).text(),
          child.exited,
        ]);
        expect(exit).toBe(0);
        return out.split("\n").filter(Boolean);
      }),
    );
    const all = printed.flat();
    expect(all).toHaveLength(40);
    const book = CodeBook.load(path);
    expect(book.size).toBe(40);
    for (const code of all) expect(book.identify(code)).toBeDefined();
  }, 20_000);
});
