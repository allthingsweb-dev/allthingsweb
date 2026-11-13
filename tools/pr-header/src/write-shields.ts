import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { allFaces } from "./faces.ts";
import { drawAll } from "./shields.ts";

/**
 * Writes every shield to shields/, with manifest.json naming each file's
 * content hash, which the header adds to its address so a redrawn shield is
 * never served from a stale cache.
 *
 *     bun run shields          # write them
 *     bun run shields --check  # fail if the committed shields are stale
 */

export const shieldsDir = join(import.meta.dir, "../shields");
export const manifestFile = "manifest.json";

/** Every file shields/ should hold, by name. */
export function expectedShields(): Map<string, string> {
  const shields = drawAll(allFaces());
  const manifest = Object.fromEntries(
    [...shields].map(([file, svg]) => [
      file,
      createHash("sha256").update(svg).digest("hex").slice(0, 12),
    ]),
  );
  return new Map([
    ...shields,
    [manifestFile, `${JSON.stringify(manifest, null, 2)}\n`],
  ]);
}

/** The files shields/ holds now. */
export function committedShields(): Map<string, string> {
  mkdirSync(shieldsDir, { recursive: true });
  return new Map(
    readdirSync(shieldsDir).map((file) => [
      file,
      readFileSync(join(shieldsDir, file), "utf8"),
    ]),
  );
}

if (import.meta.main) {
  const expected = expectedShields();
  const committed = committedShields();
  const stale = [
    ...[...expected].filter(([file, text]) => committed.get(file) !== text),
    ...[...committed.keys()]
      .filter((file) => !expected.has(file))
      .map((file) => [file, null] as const),
  ];
  if (process.argv.includes("--check")) {
    if (stale.length > 0) {
      console.error(
        `Stale shields: ${stale.map(([file]) => file).join(", ")}. Run bun run shields.`,
      );
      process.exit(1);
    }
    console.log(`${expected.size - 1} shields up to date`);
  } else {
    for (const [file, text] of stale) {
      const target = join(shieldsDir, file);
      if (text === null) unlinkSync(target);
      else await Bun.write(target, text);
    }
    console.log(`${stale.length} files written or removed`);
  }
}
