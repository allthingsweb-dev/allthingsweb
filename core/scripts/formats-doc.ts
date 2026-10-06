/**
 * Writes docs/event-formats.md from src/formats.ts, the one place each
 * kind of evening is defined. With --check it writes nothing and fails
 * when the file differs from what the module says, as CI runs it.
 *
 *   bun run formats:doc [--check]
 */
import { formatsDoc } from "../src/formats.ts";

const file = new URL("../../docs/event-formats.md", import.meta.url);
const expected = formatsDoc();

if (process.argv.includes("--check")) {
  const current = await Bun.file(file)
    .text()
    .catch(() => "");
  if (current !== expected) {
    console.error(
      "docs/event-formats.md is out of date with core/src/formats.ts: run `bun run formats:doc` in core.",
    );
    process.exit(1);
  }
  console.log("docs/event-formats.md is up to date.");
} else {
  await Bun.write(file, expected);
  console.log("Wrote docs/event-formats.md.");
}
