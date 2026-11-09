/**
 * A second process for the codes tests. `hold <path>` takes the codes lock,
 * says "locked" and holds it until killed; `generate <path> <n>` makes n
 * codes one at a time, each under the lock, and prints them.
 */
import { writeSync } from "node:fs";
import { CodeBook, withFileLock } from "../src/codes.ts";

const [mode, path = "", count = "1"] = process.argv.slice(2);
if (mode === "hold") {
  withFileLock(path, () => {
    writeSync(1, "locked\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  });
} else if (mode === "generate") {
  for (let made = 0; made < Number(count); made += 1) {
    for (const code of CodeBook.load(path, { create: true }).generate(1)) {
      writeSync(1, `${code}\n`);
    }
  }
} else {
  throw new Error(`Unknown mode: ${String(mode)}`);
}
