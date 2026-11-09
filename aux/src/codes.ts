import { dlopen, FFIType } from "bun:ffi";
import { createHmac, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { z } from "zod";

/**
 * Guest codes: printed on cards at check-in, never stored. The codes file
 * (gitignored, aux.codes.json by default) holds a random salt and, for each
 * code, its HMAC-SHA256 under that salt. A code's id, the first 12 hex
 * characters of its hash, names it in the audit log and to the host.
 *
 * A code is 10 characters of Crockford's base32, 50 random bits, printed as
 * two groups of five. Typing is forgiving: case, spaces and hyphens don't
 * matter, and i, l and o read as 1, 1 and 0.
 */

const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
const codeLength = 10;
export const idLength = 12;

/** A new code, as printed: `xxxxx-xxxxx`. */
export function newCode(random: (size: number) => Uint8Array = randomBytes) {
  // 256 is a multiple of 32, so each byte's low five bits are uniform.
  const chars = Array.from(
    random(codeLength),
    (byte) => alphabet[byte & 31] ?? "0",
  );
  return `${chars.slice(0, 5).join("")}-${chars.slice(5).join("")}`;
}

/** `input` as a code, or undefined when it can't be one. */
export function normalizeCode(input: string): string | undefined {
  const code = input
    .toLowerCase()
    .replaceAll(/[\s-]/g, "")
    .replaceAll(/[il]/g, "1")
    .replaceAll("o", "0");
  if (code.length !== codeLength) return undefined;
  for (const char of code) if (!alphabet.includes(char)) return undefined;
  return code;
}

/** A normalized code's HMAC-SHA256 under the file's salt, in hex. */
export function hashCode(salt: string, normalized: string): string {
  return createHmac("sha256", Buffer.from(salt, "hex"))
    .update(normalized)
    .digest("hex");
}

const codesFileSchema = z.object({
  version: z.literal(1),
  salt: z.string().regex(/^[0-9a-f]{64}$/),
  codes: z.array(
    z.object({
      hash: z.string().regex(/^[0-9a-f]{64}$/),
      revoked: z.boolean().optional(),
    }),
  ),
});

type CodesFile = z.infer<typeof codesFileSchema>;

const lockWaitMs = 5_000;

/** Blocks the thread for `ms`: lock waits are short, and the writes are synchronous. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;
let flockSymbol: ((fd: number, operation: number) => number) | undefined;

/**
 * flock(2) from the C library, loaded on first use: an advisory lock the
 * kernel releases when its holder closes the file or exits, a crash included.
 * Returns 0 on success and -1 when the lock is held elsewhere or fails.
 */
function flock(fd: number, operation: number): number {
  if (flockSymbol === undefined) {
    const library =
      process.platform === "darwin"
        ? "/usr/lib/libSystem.B.dylib"
        : process.platform === "linux"
          ? "libc.so.6"
          : undefined;
    if (library === undefined) {
      throw new Error(
        `Locking the codes file isn't supported on ${process.platform}.`,
      );
    }
    flockSymbol = dlopen(library, {
      flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    }).symbols.flock;
  }
  return flockSymbol(fd, operation);
}

/**
 * Runs `fn` holding an exclusive flock(2) on `<path>.lock`, so the hub
 * revoking a code and a `--generate` run never write over each other. The
 * kernel releases the lock when its holder exits, so a crash leaves nothing
 * to reclaim, and the lock file itself is never removed: no process can take
 * or delete another's lock. It waits up to `waitMs` (5 s by default).
 */
export function withFileLock<T>(
  path: string,
  fn: () => T,
  waitMs = lockWaitMs,
): T {
  const lock = `${path}.lock`;
  const fd = openSync(lock, "a", 0o600);
  try {
    const deadline = Date.now() + waitMs;
    while (flock(fd, LOCK_EX | LOCK_NB) !== 0) {
      if (Date.now() >= deadline) {
        throw new Error(`${lock} is held by another process; try again.`);
      }
      sleepSync(25);
    }
    try {
      return fn();
    } finally {
      flock(fd, LOCK_UN);
    }
  } finally {
    closeSync(fd);
  }
}

/** Reads and validates the codes file at `path`. */
function readCodesFile(path: string): CodesFile {
  const parsed = codesFileSchema.safeParse(
    JSON.parse(readFileSync(path, "utf8")),
  );
  if (!parsed.success) {
    throw new Error(`${path} is not a codes file: ${parsed.error.message}`);
  }
  return parsed.data;
}

export type RevokeResult =
  | { readonly id: string }
  | { readonly error: "unknown_code" | "ambiguous_prefix" };

export class CodeBook {
  readonly #path: string | undefined;
  #file: CodesFile;
  /** hash → revoked */
  readonly #byHash = new Map<string, boolean>();

  private constructor(path: string | undefined, file: CodesFile) {
    this.#path = path;
    this.#file = file;
    this.#index();
  }

  /** Rebuilds the hash → revoked map from the file in memory. */
  #index(): void {
    this.#byHash.clear();
    for (const { hash, revoked } of this.#file.codes) {
      this.#byHash.set(hash, revoked === true);
    }
  }

  /** Re-reads the file, if there is one, so a write merges into what's there now. */
  #reload(): void {
    if (this.#path === undefined || !existsSync(this.#path)) return;
    this.#file = readCodesFile(this.#path);
    this.#index();
  }

  /** Runs `change` on the current file under the lock, then writes it. */
  #update<T>(change: () => T): T {
    const path = this.#path;
    if (path === undefined) return change();
    return withFileLock(path, () => {
      this.#reload();
      const result = change();
      this.#write(path);
      return result;
    });
  }

  /** An empty book in memory, with a fresh salt; for tests. */
  static empty(): CodeBook {
    return new CodeBook(undefined, {
      version: 1,
      salt: randomBytes(32).toString("hex"),
      codes: [],
    });
  }

  /** The book at `path`, or a new empty one there when `create` is set. */
  static load(path: string, { create = false } = {}): CodeBook {
    if (!existsSync(path)) {
      if (!create) {
        throw new Error(
          `No codes file at ${path}. Make codes first: bun src/main.ts --generate 150`,
        );
      }
      return new CodeBook(path, {
        version: 1,
        salt: randomBytes(32).toString("hex"),
        codes: [],
      });
    }
    return new CodeBook(path, readCodesFile(path));
  }

  /** How many codes the book holds, revoked ones included. */
  get size(): number {
    return this.#byHash.size;
  }

  /** The id of the valid, unrevoked code `input`, or undefined. */
  identify(input: string): string | undefined {
    const code = normalizeCode(input);
    if (code === undefined) return undefined;
    const hash = hashCode(this.#file.salt, code);
    return this.#byHash.get(hash) === false
      ? hash.slice(0, idLength)
      : undefined;
  }

  /**
   * Makes `count` new codes, saves their hashes, and returns the codes
   * themselves: the only time they exist in plain text.
   */
  generate(count: number, random?: (size: number) => Uint8Array): string[] {
    return this.#update(() => this.#generate(count, random));
  }

  /** Draws `count` codes with distinct ids and adds their hashes, in memory. */
  #generate(count: number, random?: (size: number) => Uint8Array): string[] {
    const ids = new Set(
      [...this.#byHash.keys()].map((hash) => hash.slice(0, idLength)),
    );
    const codes: string[] = [];
    while (codes.length < count) {
      const code = newCode(random);
      const hash = hashCode(this.#file.salt, normalizeCode(code) ?? "");
      // Ids must name one code each; a clash (about 1 in 10^12) draws again.
      if (ids.has(hash.slice(0, idLength))) continue;
      ids.add(hash.slice(0, idLength));
      this.#file.codes.push({ hash });
      this.#byHash.set(hash, false);
      codes.push(code);
    }
    return codes;
  }

  /** Revokes the one code whose id starts with `prefix` (6+ hex characters). */
  revoke(prefix: string): RevokeResult {
    const needle = prefix.toLowerCase();
    if (!/^[0-9a-f]{6,64}$/.test(needle)) return { error: "unknown_code" };
    return this.#update(() => this.#revoke(needle));
  }

  /** Marks the one code whose hash starts with `needle` revoked, in memory. */
  #revoke(needle: string): RevokeResult {
    const matches = this.#file.codes.filter((entry) =>
      entry.hash.startsWith(needle),
    );
    const [match] = matches;
    if (match === undefined) return { error: "unknown_code" };
    if (matches.length > 1) return { error: "ambiguous_prefix" };
    match.revoked = true;
    this.#byHash.set(match.hash, true);
    return { id: match.hash.slice(0, idLength) };
  }

  /** Writes the book atomically, readable by its owner only. */
  #write(path: string): void {
    const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.#file, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    try {
      renameSync(temporary, path);
    } catch (error) {
      try {
        unlinkSync(temporary);
      } catch {
        // Nothing left to clean up.
      }
      throw error;
    }
  }
}
