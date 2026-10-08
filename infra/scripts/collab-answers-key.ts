/**
 * Makes COLLAB_ANSWERS_KEY, the key the rounds' answer keys are sealed with
 * at rest (core/src/collab/seal.ts): 32 random bytes, base64url, straight
 * into 1Password ("allthings collab answers key" in the allthings vault,
 * field credential), never printed. The draft preview gets it as a secret
 * at each prod deploy, and `bun run collab export` reads it to open a
 * round for the night.
 *
 * It refuses to replace a key that is there: every round sealed with it
 * would stop opening. `--rotate` first keeps the current key as "allthings
 * collab answers key (previous)", which the Worker and the studio open old
 * rounds with (COLLAB_ANSWERS_PREVIOUS_KEY), then makes a new one.
 *
 * Run it from the repository root with op signed in through
 * OP_SERVICE_ACCOUNT_TOKEN:
 *
 *   bun infra/scripts/collab-answers-key.ts            # make the key, once
 *   bun infra/scripts/collab-answers-key.ts --rotate   # keep it as previous, make a new one
 *   bun infra/scripts/collab-answers-key.ts --rotate --drop-previous   # when a previous one is there: it goes
 */
import { run, storeItem } from "./login-role.ts";

export const ITEM = "allthings collab answers key";
export const PREVIOUS = `${ITEM} (previous)`;
const VAULT = "allthings";

/** A new key: 32 random bytes as base64url, as seal.ts takes one. */
export function newAnswersKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/**
 * Why a run must not go on, if it mustn't. A rotation keeps one key back:
 * rotating again would archive it, and every round still sealed with it
 * would stop opening, so it needs --drop-previous said outright.
 */
export function rotationRefusal(asked: {
  readonly there: boolean;
  readonly rotate: boolean;
  readonly previousThere: boolean;
  readonly dropPrevious: boolean;
}): string | undefined {
  if (
    asked.there &&
    asked.rotate &&
    asked.previousThere &&
    !asked.dropPrevious
  ) {
    return `"${PREVIOUS}" is already in 1Password: rotating again would drop it, and rounds sealed with it would stop opening. Export what you need first, then rerun with --rotate --drop-previous.`;
  }
  return undefined;
}

const notes =
  "Seals the draft preview's round answer keys at rest (core/src/collab/seal.ts). Losing it loses every round sealed with it. Made by infra/scripts/collab-answers-key.ts in allthingsweb-dev/allthingsweb.";

async function exists(item: string): Promise<boolean> {
  const items = JSON.parse(
    await run(["op", "item", "list", "--vault", VAULT, "--format", "json"]),
  ) as Array<{ title: string }>;
  return items.some((found) => found.title === item);
}

async function main(): Promise<void> {
  if (!process.env["OP_SERVICE_ACCOUNT_TOKEN"]) {
    throw new Error(
      "OP_SERVICE_ACCOUNT_TOKEN is not set: op signs in with it.",
    );
  }
  const rotate = process.argv.includes("--rotate");
  const dropPrevious = process.argv.includes("--drop-previous");
  const there = await exists(ITEM);
  const refusal = rotationRefusal({
    there,
    rotate,
    previousThere: there && rotate ? await exists(PREVIOUS) : false,
    dropPrevious,
  });
  if (refusal !== undefined) throw new Error(refusal);
  if (there && !rotate) {
    console.log(
      `✓ "${ITEM}" is already in 1Password; nothing changed. --rotate keeps it as "${PREVIOUS}" and makes a new one.`,
    );
    return;
  }
  if (there) {
    const current = (
      await run(["op", "read", `op://allthings/${ITEM}/credential`])
    ).trim();
    await storeItem({ value: current, item: PREVIOUS, vault: VAULT, notes });
    console.log(`✓ kept the current key as "${PREVIOUS}"`);
  }
  await storeItem({ value: newAnswersKey(), item: ITEM, vault: VAULT, notes });
  console.log(
    `✓ made "${ITEM}" in 1Password. Deploy prod with COLLAB_ANSWERS_KEY=$(op read "op://allthings/${ITEM}/credential")${there ? ` and COLLAB_ANSWERS_PREVIOUS_KEY from "${PREVIOUS}"` : ""}.`,
  );
}

if (import.meta.main) await main();
