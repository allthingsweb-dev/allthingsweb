/**
 * zero-trust-token.sh's second half, so the token's value never passes
 * through the shell: it reads the value Cloudflare just made from stdin
 * (`store`) or from 1Password (`list`), stores it, and makes the Zero Trust
 * list of draft collaborators with it if the list isn't there. It prints the
 * list's id, which isn't a secret, and never the token.
 *
 *   … | bun infra/scripts/zero-trust-store.ts store infra/zero-trust-token.json
 *   bun infra/scripts/zero-trust-store.ts list infra/zero-trust-token.json
 */
import { run, storeItem } from "./login-role.ts";

/** The list's name, as core/src/collab/access.ts finds it (core/tests/collab-access.test.ts holds the two the same). */
export const COLLABORATOR_LIST = "allthings draft collaborators";

/** The one vault this repository reads its credentials from (core/tests/vault.test.ts). */
const VAULT = "allthings";

interface Spec {
  readonly account: string;
  readonly item: string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * The collaborators list's id, made empty if it isn't there. A token
 * Cloudflare just made can take a few seconds to be honored, so a refusal
 * is asked again, up to `tries` times.
 */
export async function ensureList(
  account: string,
  token: string,
  fetcher: Fetch = fetch,
  options: { readonly tries?: number; readonly wait?: number } = {},
): Promise<{ readonly id: string; readonly created: boolean }> {
  const api = `https://api.cloudflare.com/client/v4/accounts/${account}/gateway/lists`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const call = async (init?: RequestInit) => {
    const tries = options.tries ?? 6;
    for (let attempt = 1; ; attempt++) {
      const response = await fetcher(api, { ...init, headers });
      const body = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        errors?: Array<{ message: string }>;
        result?: unknown;
      };
      if (response.ok && body.success !== false) return body.result;
      if (
        (response.status === 401 || response.status === 403) &&
        attempt < tries
      ) {
        await sleep(options.wait ?? 5000);
        continue;
      }
      throw new Error(
        `Cloudflare answered ${response.status}: ${(body.errors ?? []).map((e) => e.message).join("; ") || "no reason given"}`,
      );
    }
  };
  const lists = (await call()) as Array<{
    id: string;
    name: string;
    type: string;
  }>;
  const found = lists.filter((list) => list.name === COLLABORATOR_LIST);
  if (found.length > 1 || found.some((list) => list.type !== "EMAIL")) {
    throw new Error(
      `"${COLLABORATOR_LIST}" must be one email list; found ${found.map((l) => `${l.id} (${l.type})`).join(", ")}. Remove the others in Zero Trust.`,
    );
  }
  const [list] = found;
  if (list !== undefined) return { id: list.id, created: false };
  const created = (await call({
    method: "POST",
    body: JSON.stringify({
      name: COLLABORATOR_LIST,
      type: "EMAIL",
      description:
        "Every active draft collaborator's email, set by bun run collab (core/src/collab/access.ts). Not managed by Alchemy.",
      items: [],
    }),
  })) as { id?: string };
  if (typeof created.id !== "string")
    throw new Error("Cloudflare made the list but returned no id");
  return { id: created.id, created: true };
}

async function main(): Promise<void> {
  const [mode, specPath] = process.argv.slice(2);
  if ((mode !== "store" && mode !== "list") || specPath === undefined) {
    throw new Error(
      "Usage: zero-trust-store.ts store|list <zero-trust-token.json>",
    );
  }
  const spec = (await Bun.file(specPath).json()) as Spec;
  let token: string;
  if (mode === "store") {
    const made = JSON.parse(await Bun.stdin.text()) as { value?: unknown };
    if (typeof made.value !== "string" || made.value === "") {
      throw new Error(
        "Cloudflare's answer has no token value: nothing was stored.",
      );
    }
    token = made.value;
    await storeItem({
      value: token,
      item: spec.item,
      vault: VAULT,
      notes:
        "The studio's token for draft collaboration's edge: the Zero Trust list of collaborators, and ending Access sessions. Rotate with infra/scripts/zero-trust-token.sh --rotate in allthingsweb-dev/allthingsweb.",
    });
    console.log(`✓ stored the token in 1Password ("${spec.item}" in ${VAULT})`);
  } else {
    token = (
      await run(["op", "read", `op://allthings/${spec.item}/credential`])
    ).trim();
    console.log(`✓ the token's policies are those in zero-trust-token.json`);
  }
  const list = await ensureList(spec.account, token);
  console.log(
    `✓ ${list.created ? "made" : "found"} the Zero Trust list "${COLLABORATOR_LIST}": ${list.id}`,
  );
  console.log(
    `  For the edge to admit collaborators, set COLLABORATOR_LIST_ID = "${list.id}" in infra/src/preview.ts and deploy prod.`,
  );
}

if (import.meta.main) await main();
