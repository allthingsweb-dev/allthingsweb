import { describe, expect, test } from "bun:test";
import { repositoryFiles, root } from "./support/repository.ts";

/**
 * The repository reads its credentials from one 1Password vault, "allthings":
 * the only vault the agents' service account can read, and the one the
 * rotation scripts (infra/scripts/site-sync.ts, site-reader.ts) write to. A
 * secret reference into any other vault reads a copy nobody rotates, so
 * every `op://` reference in the repository, in docs, scripts or code, names
 * this one.
 */

const VAULT = "allthings";

/** A secret reference's vault: what follows `op://`, up to the next slash. */
const reference = /op:\/\/([^/\s]+)\//g;

/** Every secret reference in the repository, as `path:line vault`. */
const references = async (): Promise<
  ReadonlyArray<{ readonly at: string; readonly vault: string }>
> => {
  const seen: Array<{ at: string; vault: string }> = [];
  for (const path of repositoryFiles()) {
    const file = Bun.file(`${root}${path}`);
    if (!(await file.exists())) continue;
    for (const [index, line] of (await file.text()).split("\n").entries()) {
      for (const match of line.matchAll(reference)) {
        seen.push({ at: `${path}:${index + 1}`, vault: match[1] ?? "" });
      }
    }
  }
  return seen;
};

/** Read once: both tests look at the same references. */
const found = references();

describe("1Password references", () => {
  test("finds the references the deploy and the docs make", async () => {
    const files = new Set(
      (await found).map(({ at }) => at.slice(0, at.lastIndexOf(":"))),
    );
    expect(files).toContain("infra/scripts/move-day-deploy.sh");
    expect(files).toContain("infra/README.md");
    expect(files).toContain("core/README.md");
  });

  test(`every reference reads the ${VAULT} vault`, async () => {
    const elsewhere = (await found)
      .filter(({ vault }) => vault !== VAULT)
      .map(({ at, vault }) => `${at} reads the ${vault} vault`);
    expect(elsewhere).toEqual([]);
  });
});
