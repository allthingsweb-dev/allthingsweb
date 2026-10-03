import { configSchema, server } from "better-env/config-schema";
import { z } from "zod";

const mediaEnvConfig = configSchema("Media", {
  publicUrl: server({
    env: "MEDIA_PUBLIC_URL",
    schema: z.url(),
  }),
  // Only deployments that upload need these; local development doesn't.
  uploadUrl: server({
    env: "MEDIA_UPLOAD_URL",
    schema: z.url(),
    optional: true,
  }),
  uploadToken: server({
    env: "MEDIA_UPLOAD_TOKEN",
    optional: true,
  }),
});

export const mediaConfig = {
  publicUrl: mediaEnvConfig.server.publicUrl,
  uploadUrl: mediaEnvConfig.server.uploadUrl,
  uploadToken: mediaEnvConfig.server.uploadToken,
};
