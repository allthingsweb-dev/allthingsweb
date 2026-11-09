import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

export type RevokeResult =
  | { readonly id: string }
  | { readonly error: "unknown_code" | "ambiguous_prefix" };

export class CodeBook {
  readonly #path: string | undefined;
  readonly #file: CodesFile;
  /** hash → revoked */
  readonly #byHash = new Map<string, boolean>();

  private constructor(path: string | undefined, file: CodesFile) {
    this.#path = path;
    this.#file = file;
    for (const { hash, revoked } of file.codes) {
      this.#byHash.set(hash, revoked === true);
    }
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
    const parsed = codesFileSchema.safeParse(
      JSON.parse(readFileSync(path, "utf8")),
    );
    if (!parsed.success) {
      throw new Error(`${path} is not a codes file: ${parsed.error.message}`);
    }
    return new CodeBook(path, parsed.data);
  }

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
    this.save();
    return codes;
  }

  /** Revokes the one code whose id starts with `prefix` (6+ hex characters). */
  revoke(prefix: string): RevokeResult {
    const needle = prefix.toLowerCase();
    if (!/^[0-9a-f]{6,64}$/.test(needle)) return { error: "unknown_code" };
    const matches = this.#file.codes.filter((entry) =>
      entry.hash.startsWith(needle),
    );
    const [match] = matches;
    if (match === undefined) return { error: "unknown_code" };
    if (matches.length > 1) return { error: "ambiguous_prefix" };
    match.revoked = true;
    this.#byHash.set(match.hash, true);
    this.save();
    return { id: match.hash.slice(0, idLength) };
  }

  /** Writes the book atomically, readable by its owner only. */
  save(): void {
    if (this.#path === undefined) return;
    const temporary = `${this.#path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.#file, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(temporary, this.#path);
  }
}
