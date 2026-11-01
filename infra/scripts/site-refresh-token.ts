/**
 * Makes SITE_REFRESH_TOKEN, the token the writers tell prod's site its data
 * changed with (web/src/refresh.ts): 32 random bytes, base64url, straight
 * into 1Password ("allthings site refresh" in the allthings vault, field
 * credential), never printed. A prod deploy gives it to the Web Worker and
 * the Sync Worker, which sends it after each run that writes.
 *
 * The token lets its holder ask the site to read the data's version now,
 * nothing else, so rotating it costs nothing but a deploy: `--rotate`
 * replaces it, and the next prod deploy carries the new one. Until then
 * the writers' requests are refused and the site checks on its own.
 *
 * Run it from the repository root with op signed in through
 * OP_SERVICE_ACCOUNT_TOKEN:
 *
 *   bun infra/scripts/site-refresh-token.ts            # make the token, once
 *   bun infra/scripts/site-refresh-token.ts --rotate   # replace it, then deploy prod
 */
import { newAnswersKey } from "./collab-answers-key.ts";
import { run, storeItem } from "./login-role.ts";

export const ITEM = "allthings site refresh";
const VAULT = "allthings";

const notes =
  "Lets whatever writes allthings.dev's data (the Sync Worker) tell the site it changed (web/src/refresh.ts in allthingsweb-dev/allthingsweb). Made by infra/scripts/site-refresh-token.ts; rotate with --rotate, then deploy prod.";

async function main(): Promise<void> {
  if (!process.env["OP_SERVICE_ACCOUNT_TOKEN"]) {
    throw new Error(
      "OP_SERVICE_ACCOUNT_TOKEN is not set: op signs in with it.",
    );
  }
  const items = JSON.parse(
    await run(["op", "item", "list", "--vault", VAULT, "--format", "json"]),
  ) as Array<{ title: string }>;
  const there = items.some((found) => found.title === ITEM);
  if (there && !process.argv.includes("--rotate")) {
    console.log(
      `✓ "${ITEM}" is already in 1Password; nothing changed. --rotate replaces it.`,
    );
    return;
  }
  // The same 32 random bytes, base64url, as the collab answers key.
  await storeItem({ value: newAnswersKey(), item: ITEM, vault: VAULT, notes });
  console.log(
    `✓ ${there ? "replaced" : "made"} "${ITEM}" in 1Password. Deploy prod with SITE_REFRESH_TOKEN=$(op read "op://allthings/${ITEM}/credential").`,
  );
}

if (import.meta.main) await main();
