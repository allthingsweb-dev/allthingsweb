import type { BuildId } from "../scripts/build.ts";
import shipped from "../dist/build-id.json" with { type: "json" };

/**
 * The build's content hash (dist/build.json's `build`), alone: what the
 * Worker keeps pages by and prewarms for on a cold start. The rest of the
 * manifest (src/assets.ts) loads with the app, so a cold start never
 * parses the hashed paths of every font, mark and card.
 */
export const buildId: string = (shipped satisfies BuildId).build;
