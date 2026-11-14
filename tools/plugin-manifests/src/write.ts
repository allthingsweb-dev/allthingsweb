import { join } from "node:path";
import { manifests, text } from "./manifests.ts";

/**
 * `bun run write`: writes every agent's manifest for the allthings plugin
 * from the one definition in manifests.ts.
 */

const root = join(import.meta.dir, "../../..");

for (const manifest of manifests()) {
  await Bun.write(join(root, manifest.path), text(manifest));
  console.log(`wrote ${manifest.path}`);
}
