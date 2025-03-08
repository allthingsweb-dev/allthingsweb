import { z } from "zod";

const ClientConfigSchema = z.object({
  origin: z.string().url(),
  clerk: z.object({
    publishableKey: z.string(),
  }),
  zero: z.object({
    serverUrl: z.string().url(),
  }),
});

export function getConfig() {
  const configMeta: HTMLMetaElement | null = document.querySelector(
    "meta[name='config']",
  );
  if (!configMeta) {
    throw new Error("Config meta not found");
  }

  const config = ClientConfigSchema.parse(JSON.parse(configMeta.content));
  return config;
}

export type ClientConfig = ReturnType<typeof getConfig>;
