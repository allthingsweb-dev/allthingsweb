/**
 * JSON as the repository's files are formatted (Prettier's JSON style at
 * its default 80 columns), so a command that rewrites a reviewed file,
 * such as `bun run people posts --refresh`, changes only the values it
 * means to: objects one key a line, arrays of plain values on one line
 * where they fit, else one value a line. tests/json-file.test.ts holds it
 * to core/backfill/people.json as it is.
 */

const width = 80;

type Json = null | boolean | number | string | ReadonlyArray<Json> | JsonObject;
interface JsonObject {
  readonly [key: string]: Json;
}

const isPlain = (value: Json) => value === null || typeof value !== "object";

/** `value` as it would sit after `prefix` on a line indented `indent`, then `suffix`. */
function format(
  value: Json,
  indent: string,
  prefix: number,
  suffix: number,
): string {
  if (isPlain(value)) return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    const items = value as ReadonlyArray<Json>;
    if (items.length === 0) return "[]";
    if (items.every(isPlain)) {
      const flat = `[${items.map((item) => JSON.stringify(item)).join(", ")}]`;
      if (prefix + flat.length + suffix <= width) return flat;
    }
    return `[\n${items
      .map(
        (item, index) =>
          `${inner}${format(item, inner, inner.length, index < items.length - 1 ? 1 : 0)}`,
      )
      .join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value as JsonObject);
  if (entries.length === 0) return "{}";
  return `{\n${entries
    .map(([key, item], index) => {
      const head = `${inner}${JSON.stringify(key)}: `;
      return `${head}${format(item, inner, head.length, index < entries.length - 1 ? 1 : 0)}`;
    })
    .join(",\n")}\n${indent}}`;
}

/** `value` as the file's text, ending in a newline. */
export const formatJsonFile = (value: unknown): string =>
  `${format(value as Json, "", 0, 0)}\n`;
