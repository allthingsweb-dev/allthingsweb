import type { BuildManifest } from "../scripts/build.ts";
import manifest from "../dist/build.json" with { type: "json" };

/**
 * What web/scripts/build.ts built: the content-hashed paths of the
 * stylesheet, fonts and marks, and the foundations as HTML. `bun run build`
 * writes it; the test, typecheck and deploy steps build first.
 */
export const built: BuildManifest = manifest;
