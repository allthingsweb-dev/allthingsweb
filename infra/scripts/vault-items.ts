/**
 * Checks infra/vault-items.json against the allthings 1Password vault itself:
 * every item the list says is there (and each of its fields) is, and every
 * item marked `pending` still isn't, so the list core/tests/vault.test.ts
 * holds every `op://` reference to stays true. It reads titles and field
 * labels only; no value is ever read into this process's output.
 *
 *   OP_SERVICE_ACCOUNT_TOKEN=… bun infra/scripts/vault-items.ts
 *
 * Your own `op` session works too. It exits 1, naming each difference.
 */
import { run } from "./login-role.ts";

export interface VaultItem {
  readonly title: string;
  readonly fields: ReadonlyArray<string>;
  readonly pending?: boolean;
}

export interface VaultItems {
  readonly vault: string;
  readonly items: ReadonlyArray<VaultItem>;
}

/** The checked-in list. */
export const vaultItems = async (): Promise<VaultItems> =>
  (await Bun.file(
    new URL("../vault-items.json", import.meta.url),
  ).json()) as VaultItems;

/** What differs between the list and what the vault holds: titles and field labels. */
export function differences(
  listed: VaultItems,
  held: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlyArray<string> {
  const found: Array<string> = [];
  for (const item of listed.items) {
    const fields = held.get(item.title);
    if (item.pending === true) {
      if (fields !== undefined) {
        found.push(
          `"${item.title}" is in the vault now: drop its "pending" in infra/vault-items.json`,
        );
      }
      continue;
    }
    if (fields === undefined) {
      found.push(
        `"${item.title}" is listed but not in the ${listed.vault} vault`,
      );
      continue;
    }
    for (const field of item.fields) {
      if (!fields.has(field)) {
        found.push(`"${item.title}" has no field "${field}"`);
      }
    }
  }
  const titles = new Set(listed.items.map((item) => item.title));
  for (const title of held.keys()) {
    if (!titles.has(title)) {
      found.push(
        `"${title}" is in the vault but not in infra/vault-items.json`,
      );
    }
  }
  return found.toSorted();
}

/** Reads the vault's titles and field labels, and exits 1 on any difference from the list. */
async function main(): Promise<void> {
  const listed = await vaultItems();
  const summaries = JSON.parse(
    await run([
      "op",
      "item",
      "list",
      "--vault",
      listed.vault,
      "--format",
      "json",
    ]),
  ) as Array<{ id: string; title: string }>;
  const held = new Map<string, Set<string>>();
  for (const { id, title } of summaries) {
    // Only the labels leave this loop: the item's values are dropped here.
    const item = JSON.parse(
      await run([
        "op",
        "item",
        "get",
        id,
        "--vault",
        listed.vault,
        "--format",
        "json",
      ]),
    ) as { fields?: Array<{ label?: string }> };
    held.set(
      title,
      new Set((item.fields ?? []).flatMap((field) => field.label ?? [])),
    );
  }
  const found = differences(listed, held);
  if (found.length > 0) {
    console.error(found.map((line) => `✗ ${line}`).join("\n"));
    process.exit(1);
  }
  console.log(
    `✓ infra/vault-items.json matches the ${listed.vault} vault (${summaries.length} items)`,
  );
}

if (import.meta.main) await main();
