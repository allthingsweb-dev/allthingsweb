import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
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

  test("clears a stale lock left by a crash", () => {
    const path = join(directory, "stale.json");
    writeFileSync(`${path}.lock`, "");
    const old = new Date(Date.now() - 60_000);
    utimesSync(`${path}.lock`, old, old);
    const book = CodeBook.load(path, { create: true });
    expect(book.generate(1)).toHaveLength(1);
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  test("waits for a fresh lock, then gives up after 5 s and leaves it alone", () => {
    const path = join(directory, "busy.json");
    writeFileSync(`${path}.lock`, "another-process");
    const book = CodeBook.load(path, { create: true });
    const started = Date.now();
    expect(() => book.generate(1)).toThrow("is held by another process");
    expect(Date.now() - started).toBeGreaterThanOrEqual(4_900);
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("another-process");
  }, 10_000);

  test("never releases a lock it no longer owns", () => {
    const path = join(directory, "owned.json");
    withFileLock(path, () => writeFileSync(`${path}.lock`, "someone-else"));
    expect(readFileSync(`${path}.lock`, "utf8")).toBe("someone-else");
  });
});
