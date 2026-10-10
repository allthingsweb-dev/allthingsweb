import { describe, expect, test } from "bun:test";
import {
  STUDIO_COMMANDS,
  studioCommandOf,
} from "../../infra/scripts/studio.ts";
import { vaultItems } from "../../infra/scripts/vault-items.ts";
import { repositoryFiles, root } from "./support/repository.ts";

/**
 * The repository reads its credentials from one 1Password vault, "allthings":
 * the only vault the agents' service account can read, and the one the
 * rotation scripts (infra/scripts/site-sync.ts, site-reader.ts, studio.ts)
 * write to. A secret reference into any other vault reads a copy nobody
 * rotates, so every `op://` reference in the repository, in docs, scripts
 * or code, names this one, and an item and field infra/vault-items.json
 * lists: a reference to an item nobody made sends whoever follows it
 * looking for it.
 *
 * And the studio's commands connect as the studio (core's README, "The
 * studio's connection"): every documented invocation of one reads the
 * studio's credential, and nothing else does.
 */

const VAULT = "allthings";

/** The studio's credential, as every documented studio command reads it. */
const STUDIO_URL = `DATABASE_URL=$(op read "op://allthings/allthings studio/credential")`;

/** A secret reference's vault: what follows `op://`, up to the next slash. */
const reference = /op:\/\/([^/\s]+)\//g;

/**
 * A reference into the vault, with its item and field: what follows the
 * vault up to the next slash, then up to a closing quote or parenthesis.
 * One built from a variable (`${ITEM}`) names no item here, and a quote
 * escaped inside a string (`\"`) ends it too.
 */
const itemReference = /op:\/\/allthings\/([^/"'`\\\n]+)\/([^"'`)\\\n]+)/g;

/** Every line of every file in the repository, with where it is. */
const lines = async (): Promise<
  ReadonlyArray<{
    readonly path: string;
    readonly at: string;
    readonly line: string;
  }>
> => {
  const seen: Array<{ path: string; at: string; line: string }> = [];
  for (const path of repositoryFiles()) {
    const file = Bun.file(`${root}${path}`);
    if (!(await file.exists())) continue;
    for (const [index, line] of (await file.text()).split("\n").entries()) {
      seen.push({ path, at: `${path}:${index + 1}`, line });
    }
  }
  return seen;
};

/** Read once: every test looks at the same lines. */
const found = lines();

/** Every secret reference in the repository, as `path:line vault`. */
const references = async () =>
  (await found).flatMap(({ at, line }) =>
    [...line.matchAll(reference)].map((match) => ({
      at,
      vault: match[1] ?? "",
    })),
  );

/**
 * The commands core's docs show: each logical line (joined across `\`) of
 * every fenced code block in core's markdown, the root README and docs/,
 * that runs `bun run`. Other packages (infra, app, web) have scripts of
 * their own by the same names (infra's `bun run plan`), so their docs
 * aren't read here.
 */
const documented = async () => {
  const commands: Array<{ at: string; text: string }> = [];
  const byFile = new Map<string, Array<{ at: string; line: string }>>();
  for (const { path, at, line } of await found) {
    const ours =
      path.endsWith(".md") &&
      (path.startsWith("core/") ||
        path.startsWith("docs/") ||
        !path.includes("/"));
    if (!ours) continue;
    byFile.set(path, [...(byFile.get(path) ?? []), { at, line }]);
  }
  for (const fileLines of byFile.values()) {
    let fenced = false;
    let open: { at: string; text: string } | undefined;
    for (const { at, line } of fileLines) {
      if (line.trimStart().startsWith("```")) {
        fenced = !fenced;
        open = undefined;
        continue;
      }
      if (!fenced) continue;
      open =
        open === undefined
          ? { at, text: line }
          : { at: open.at, text: `${open.text} ${line.trim()}` };
      if (open.text.endsWith("\\")) {
        open = { at: open.at, text: open.text.slice(0, -1).trimEnd() };
        continue;
      }
      if (open.text.includes("bun run ")) commands.push(open);
      open = undefined;
    }
  }
  return commands;
};

/** The studio command `text` runs, if any. */
const studioCommand = (text: string) => {
  const words = text
    .slice(text.indexOf("bun run ") + "bun run ".length)
    .split(/\s+/)
    .filter((word) => word !== "");
  const [script, ...args] = words;
  return script === undefined ? undefined : studioCommandOf(script, args);
};

describe("1Password references", () => {
  test("finds the references the deploy and the docs make", async () => {
    const files = new Set(
      (await references()).map(({ at }) => at.slice(0, at.lastIndexOf(":"))),
    );
    expect(files).toContain("infra/scripts/move-day-deploy.sh");
    expect(files).toContain("infra/README.md");
    expect(files).toContain("core/README.md");
  });

  test(`every reference reads the ${VAULT} vault`, async () => {
    const elsewhere = (await references())
      .filter(({ vault }) => vault !== VAULT)
      .map(({ at, vault }) => `${at} reads the ${vault} vault`);
    expect(elsewhere).toEqual([]);
  });

  test("every item and field referenced is in infra/vault-items.json", async () => {
    const listed = await vaultItems();
    expect(listed.vault).toBe(VAULT);
    const fields = new Map(
      listed.items.map((item) => [item.title, new Set(item.fields)]),
    );
    const named = (await found).flatMap(({ at, line }) =>
      [...line.matchAll(itemReference)].map((match) => ({
        at,
        item: match[1] ?? "",
        field: match[2] ?? "",
      })),
    );
    expect(named.length).toBeGreaterThan(0);
    const unknown = named
      .filter(({ item }) => !item.includes("${"))
      .flatMap(({ at, item, field }) => {
        const known = fields.get(item);
        if (known === undefined) return [`${at} names "${item}", not listed`];
        if (!known.has(field))
          return [`${at} names "${item}/${field}", no such field listed`];
        return [];
      });
    expect(unknown).toEqual([]);
  });

  test("the list holds no item for the database owner", async () => {
    // The owner's connection is fetched with neonctl and never stored.
    const owners = (await vaultItems()).items.filter((item) =>
      /owner/i.test(item.title),
    );
    expect(owners).toEqual([]);
  });
});

describe("the studio's commands, as documented", () => {
  test("are found", async () => {
    const shown = new Set(
      (await documented()).flatMap(({ text }) => studioCommand(text) ?? []),
    );
    // Every studio command is documented at least once.
    expect([...shown].toSorted()).toEqual([...STUDIO_COMMANDS].toSorted());
  });

  test("each reads the studio's credential", async () => {
    const missing = (await documented())
      .filter(
        ({ text }) =>
          studioCommand(text) !== undefined && !text.includes(STUDIO_URL),
      )
      .map(({ at, text }) => `${at}: ${text}`);
    expect(missing).toEqual([]);
  });

  test("and nothing else does", async () => {
    const borrowed = (await documented())
      .filter(
        ({ text }) =>
          text.includes("allthings studio/") &&
          studioCommand(text) === undefined,
      )
      .map(({ at, text }) => `${at}: ${text}`);
    expect(borrowed).toEqual([]);
  });
});
