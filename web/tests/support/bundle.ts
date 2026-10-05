/**
 * What a bundle is made of: each source's share of the minified code, read
 * from the bundle's source map. Every byte of a generated line belongs to
 * the source of the mapping segment it follows; bytes before a line's first
 * segment, and segments without a source, are the bundler's own.
 */

export interface SourceMap {
  readonly sources: ReadonlyArray<string>;
  readonly mappings: string;
}

const base64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Each Base64 digit's value. The alphabet is ASCII, one code unit a digit. */
const digit = new Map(
  Array.from(
    { length: base64.length },
    (_, index) => [base64.charAt(index), index] as const,
  ),
);

/** The fields of one mapping segment (Base64 VLQ, as source maps v3 write them). */
function decodeSegment(segment: string): Array<number> {
  const fields: Array<number> = [];
  let value = 0;
  let shift = 0;
  for (const character of segment) {
    const bits = digit.get(character);
    if (bits === undefined) throw new Error(`Not Base64 VLQ: ${character}`);
    value += (bits & 31) << shift;
    if (bits & 32) {
      shift += 5;
      continue;
    }
    fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  return fields;
}

/** Bytes of generated code per source index (-1: the bundler's own). */
export function bytesBySource(
  code: string,
  map: SourceMap,
): Map<number, Array<string>> {
  const lines = code.split("\n");
  const pieces = new Map<number, Array<string>>();
  const add = (source: number, text: string) => {
    if (text === "") return;
    const list = pieces.get(source) ?? [];
    list.push(text);
    pieces.set(source, list);
  };
  let source = 0;
  const mappings = map.mappings.split(";");
  lines.forEach((line, lineIndex) => {
    const lineMappings = mappings[lineIndex] ?? "";
    let column = 0;
    const segments: Array<{ column: number; source: number }> = [];
    for (const segment of lineMappings.split(",")) {
      if (segment === "") continue;
      const fields = decodeSegment(segment);
      column += fields[0] ?? 0;
      if (fields.length >= 4) {
        source += fields[1] ?? 0;
        segments.push({ column, source });
      } else {
        segments.push({ column, source: -1 });
      }
    }
    add(-1, line.slice(0, segments[0]?.column ?? line.length));
    segments.forEach((segment, index) => {
      const end = segments[index + 1]?.column ?? line.length;
      add(segment.source, line.slice(segment.column, end));
    });
  });
  return pieces;
}

/**
 * The contributor a source belongs to: a package by its name (and, for
 * Effect, the module), or a file of this repository by its path.
 */
export function contributorOf(source: string): string {
  const inModules =
    /node_modules\/(?:\.bun\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)\/(.*)$/.exec(
      source,
    );
  if (inModules !== null) {
    const [, name = "", rest = ""] = inModules;
    if (name === "effect" || name === "@effect/sql-pg") {
      const module = rest
        .replace(/^(?:dist|src)\//, "")
        .replace(/\.[jt]s$/, "");
      return `${name}/${module}`;
    }
    return name;
  }
  const inRepo = /(?:^|\/)((?:web|core|brand)\/(?:src|dist|scripts)\/.*)$/.exec(
    source,
  );
  return inRepo?.[1] ?? source.replace(/^(\.\.\/)+/, "");
}

export interface Contributor {
  readonly name: string;
  /** Minified bytes. */
  readonly bytes: number;
  /** Its share of the bundle's gzipped size, in proportion to its bytes. */
  readonly gzipped: number;
}

/** The bundle's contributors, largest first, grouped by `group`. */
export function contributors(
  code: string,
  map: SourceMap,
  gzippedTotal: number,
  group: (source: string) => string = contributorOf,
): Array<Contributor> {
  const bytes = new Map<string, number>();
  for (const [index, texts] of bytesBySource(code, map)) {
    const name = index === -1 ? "(bundler)" : group(map.sources[index] ?? "?");
    const size = texts.reduce((sum, text) => sum + Buffer.byteLength(text), 0);
    bytes.set(name, (bytes.get(name) ?? 0) + size);
  }
  const total = Buffer.byteLength(code);
  return [...bytes]
    .map(([name, size]) => ({
      name,
      bytes: size,
      gzipped: Math.round((gzippedTotal * size) / total),
    }))
    .toSorted((a, b) => b.bytes - a.bytes);
}

/** `contributors` as a table, the first `limit` of them. */
export function contributorTable(
  list: ReadonlyArray<Contributor>,
  limit = 25,
): string {
  const kb = (n: number) => `${(n / 1000).toFixed(1)} KB`;
  return list
    .slice(0, limit)
    .map(
      ({ name, bytes, gzipped }) =>
        `${kb(gzipped).padStart(9)} gz  ${kb(bytes).padStart(9)}  ${name}`,
    )
    .join("\n");
}

/** One module of a bundle, as the bundler wrote it. */
export interface Chunk {
  readonly file: string;
  /** Gzipped at level 9, as uploaded. */
  readonly gzipped: number;
  /** Loaded with the entry (statically imported), or only on first use. */
  readonly startup: boolean;
}

/** The modules a bundle's code imports statically (`import … from "./x.js"`). */
const staticImports = (code: string): Array<string> =>
  [
    ...code.matchAll(
      /(?:^|[;}\s])(?:import|export)\s*(?:[^"'();]*?\bfrom\s*)?["']\.\/([^"']+\.js)["']/g,
    ),
  ].map(([, file]) => file ?? "");

/** The modules a bundle's code loads on first use (`import("./x.js")`). */
const dynamicImports = (code: string): Array<string> =>
  [...code.matchAll(/\bimport\(\s*["'`]\.\/([^"'`]+\.js)["'`]\s*\)/g)].map(
    ([, file]) => file ?? "",
  );

/**
 * The modules of the bundle in `directory` (as Alchemy writes it): the
 * entry (`worker.js`) and every module it imports statically are parsed on
 * each cold start; those reached only through `import()` load on first
 * use. Files nothing reaches, such as an earlier build's, are not counted.
 */
export async function chunksOf(directory: string): Promise<Array<Chunk>> {
  const files = await Array.fromAsync(
    new Bun.Glob("*.js").scan({ cwd: directory }),
  );
  const code = new Map(
    await Promise.all(
      files.map(
        async (file) =>
          [file, await Bun.file(`${directory}/${file}`).text()] as const,
      ),
    ),
  );
  const startup = new Set<string>();
  const visit = (file: string) => {
    if (startup.has(file) || !code.has(file)) return;
    startup.add(file);
    for (const imported of staticImports(code.get(file) ?? "")) visit(imported);
  };
  visit("worker.js");
  const reached = new Set(startup);
  const reach = (file: string) => {
    for (const imported of [
      ...staticImports(code.get(file) ?? ""),
      ...dynamicImports(code.get(file) ?? ""),
    ]) {
      if (reached.has(imported) || !code.has(imported)) continue;
      reached.add(imported);
      reach(imported);
    }
  };
  for (const file of startup) reach(file);
  return [...reached]
    .map((file) => ({
      file,
      gzipped: Bun.gzipSync(code.get(file) ?? "", { level: 9 }).byteLength,
      startup: startup.has(file),
    }))
    .toSorted((a, b) => b.gzipped - a.gzipped);
}

/** What the cold-start modules are made of, largest first. */
export async function startupContributors(
  directory: string,
): Promise<Array<Contributor>> {
  const totals = new Map<string, Contributor>();
  for (const chunk of await chunksOf(directory)) {
    if (!chunk.startup) continue;
    const code = await Bun.file(`${directory}/${chunk.file}`).text();
    const map = Bun.file(`${directory}/${chunk.file}.map`);
    if (!(await map.exists())) continue;
    for (const contributor of contributors(
      code,
      await map.json(),
      chunk.gzipped,
    )) {
      const sum = totals.get(contributor.name);
      totals.set(contributor.name, {
        name: contributor.name,
        bytes: (sum?.bytes ?? 0) + contributor.bytes,
        gzipped: (sum?.gzipped ?? 0) + contributor.gzipped,
      });
    }
  }
  return [...totals.values()].toSorted((a, b) => b.gzipped - a.gzipped);
}

export interface BundleBudgets {
  /** The most the cold-start modules may weigh together, gzipped. */
  readonly startup: number;
  /** The most any module loaded on first use may weigh, gzipped. */
  readonly lazy: number;
}

/**
 * Whether the bundle in `directory` is within `budgets`: nothing when it
 * is, and otherwise what is over and what the cold start is made of, so an
 * overrun explains itself.
 */
export async function budgetProblems(
  directory: string,
  budgets: BundleBudgets,
): Promise<string | undefined> {
  const chunks = await chunksOf(directory);
  if (!chunks.some((chunk) => chunk.file === "worker.js")) {
    return `No worker.js in ${directory}`;
  }
  const startup = chunks
    .filter((chunk) => chunk.startup)
    .reduce((sum, chunk) => sum + chunk.gzipped, 0);
  const problems = [
    ...(startup > budgets.startup
      ? [
          `Cold-start modules weigh ${startup} bytes gzipped, over ${budgets.startup}.`,
        ]
      : []),
    ...chunks
      .filter((chunk) => !chunk.startup && chunk.gzipped > budgets.lazy)
      .map(
        (chunk) =>
          `${chunk.file}, loaded on first use, weighs ${chunk.gzipped} bytes gzipped, over ${budgets.lazy}.`,
      ),
  ];
  if (problems.length === 0) return undefined;
  const modules = chunks
    .map(
      (chunk) =>
        `${(chunk.gzipped / 1000).toFixed(1).padStart(7)} KB gz  ${chunk.startup ? "cold start" : "on first use"}  ${chunk.file}`,
    )
    .join("\n");
  return [
    ...problems,
    "",
    "Modules:",
    modules,
    "",
    "What the cold start is made of:",
    contributorTable(await startupContributors(directory), 30),
  ].join("\n");
}
