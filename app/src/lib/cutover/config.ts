import { configSchema, server } from "better-env/config-schema";
import { z } from "zod";

/**
 * Whether this site redirects everything to allthings.dev (src/lib/cutover.ts).
 * Off unless `ALLTHINGS_DEV_REDIRECT` is "on"; the flip is setting it and
 * redeploying (infra/docs/r2-migration.md, "Later: the full cutover").
 */
const cutoverEnvConfig = configSchema("Cutover", {
  redirect: server({
    env: "ALLTHINGS_DEV_REDIRECT",
    schema: z.enum(["on", "off"]).default("off"),
  }),
});

export const cutoverConfig = {
  redirectToAllthingsDev: cutoverEnvConfig.server.redirect === "on",
};
