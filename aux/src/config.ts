import { readFileSync } from "node:fs";
import { z } from "zod";
import { slugPattern } from "./catalog.ts";
import { isPrivateIPv4 } from "./hue.ts";
import { flash } from "./policy.ts";

/**
 * The hub's configuration: aux.config.json (gitignored), copied from
 * aux.config.example.json, then these environment variables over it:
 *
 * - `AUX_CONFIG`: the config file's path
 * - `AUX_PORT`, `AUX_HOST_TOKEN`, `AUX_BRIDGE_IP`, `AUX_HUE_APP_KEY`
 *
 * The codes file and the audit log are named by `AUX_CODES_FILE` and
 * `AUX_LOG_FILE` alone (main.ts), so `--generate` needs no config.
 *
 * Objects are strict, so a key the hub doesn't know (an `effect` or an
 * `alert` in a scene, say) is refused rather than ignored.
 */

const nameSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9 -]{0,31}$/,
    "names are lowercase letters, digits, spaces and hyphens, up to 32",
  );

const brightnessSchema = z
  .number()
  .min(flash.brightnessMin)
  .max(flash.brightnessMax);

const colorSchema = z.union([
  z
    .object({
      xy: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
      brightness: brightnessSchema.optional(),
    })
    .strict(),
  z
    .object({
      mirek: z.number().int().min(153).max(500),
      brightness: brightnessSchema.optional(),
    })
    .strict(),
]);

/** A scene: up to three zones, each set to a palette color and brightness. */
const sceneSchema = z.record(
  nameSchema,
  z.object({ color: nameSchema, brightness: brightnessSchema }).strict(),
);

/** The longest bearer token the hub reads (Hub.identify): longer ones are refused. */
export const maxSecretLength = 256;

const secret = (what: string, min: number) =>
  z
    .string()
    .regex(
      new RegExp(`^[\\w-]{${min},${maxSecretLength}}$`),
      `${what} must be ${min} to ${maxSecretLength} letters, digits, _ or -`,
    );

const musicSchema = z
  .object({
    /** mus.ax, whose public API lists the tracks and serves their MP3s. */
    base: z
      .string()
      .refine(
        (value) => URL.canParse(value) && new URL(value).protocol === "https:",
        "music.base must be an https URL",
      )
      .default("https://mus.ax"),
    /** The set: mus.ax slugs, in the order they play when nobody queues. */
    tracks: z
      .array(
        z
          .string()
          .regex(
            slugPattern,
            "music.tracks are mus.ax slugs: lowercase letters, digits and hyphens",
          ),
      )
      .min(1)
      .max(100)
      .refine(
        (tracks) => new Set(tracks).size === tracks.length,
        "music.tracks repeats a slug",
      ),
    /** Where --prefetch saves the MP3s and their manifest (gitignored). */
    cacheDir: z.string().min(1).default("aux.music"),
    /** The volume ceiling agreed with the venue, 0 to 1 (afplay -v). Guests can't change it. */
    volume: z.number().min(0).max(1),
  })
  .strict();

export const configSchema = z
  .object({
    port: z.number().int().min(1).max(65_535).default(8787),
    /** The host's bearer token for the host tools. Never a guest code. */
    hostToken: secret("hostToken", 32),
    /** Guests start frozen; the host opens the lights with host_freeze. */
    startFrozen: z.boolean().default(true),
    /** The fade on every change; the flash guard's 1.5 s is the floor. */
    transitionMs: z
      .number()
      .int()
      .min(flash.minTransitionMs)
      .max(10_000)
      .default(2_000),
    /** Requests a minute from one address, before any code is read. */
    addressLimitPerMinute: z.number().int().min(10).default(600),
    /** The brightness of set_color when its palette color names none. */
    colorBrightness: brightnessSchema.default(60),
    bridge: z
      .object({
        ip: z
          .string()
          .refine(isPrivateIPv4, "bridge.ip must be a private IPv4 address"),
        appKey: secret("bridge.appKey", 20),
      })
      .strict(),
    /** Zone name → the Bridge's grouped_light id (bun src/main.ts --zones). */
    zones: z.record(nameSchema, z.string().min(1).max(64)),
    /** The zone set_color sets when the guest names none. */
    defaultZone: nameSchema,
    palette: z.record(nameSchema, colorSchema),
    scenes: z.record(nameSchema, sceneSchema),
    /** The curated mus.ax set; without it, the music tools stay out of tools/list. */
    music: musicSchema.optional(),
  })
  .strict()
  .superRefine((config, context) => {
    const zones = Object.keys(config.zones);
    if (zones.length === 0) {
      context.addIssue({ code: "custom", message: "zones is empty" });
    }
    if (!zones.includes(config.defaultZone)) {
      context.addIssue({
        code: "custom",
        message: `defaultZone "${config.defaultZone}" is not in zones`,
      });
    }
    if (Object.keys(config.palette).length === 0) {
      context.addIssue({ code: "custom", message: "palette is empty" });
    }
    if (Object.keys(config.scenes).length === 0) {
      context.addIssue({ code: "custom", message: "scenes is empty" });
    }
    for (const [scene, parts] of Object.entries(config.scenes)) {
      const entries = Object.entries(parts);
      // Each zone is one group command; Hue asks for about one a second.
      if (entries.length === 0 || entries.length > 3) {
        context.addIssue({
          code: "custom",
          message: `scene "${scene}" must set 1 to 3 zones`,
        });
      }
      for (const [zone, { color }] of entries) {
        if (!zones.includes(zone)) {
          context.addIssue({
            code: "custom",
            message: `scene "${scene}" sets zone "${zone}", which is not in zones`,
          });
        }
        if (!(color in config.palette)) {
          context.addIssue({
            code: "custom",
            message: `scene "${scene}" uses color "${color}", which is not in palette`,
          });
        }
      }
    }
  });

export type Config = z.infer<typeof configSchema>;

type Env = Readonly<Record<string, string | undefined>>;

/** `raw` (the parsed file) with the environment's overrides, validated. */
export function parseConfig(raw: unknown, env: Env = {}): Config {
  const base =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const bridge =
    typeof base["bridge"] === "object" && base["bridge"] !== null
      ? (base["bridge"] as Record<string, unknown>)
      : {};
  const merged: Record<string, unknown> = {
    ...base,
    ...(env["AUX_PORT"] === undefined ? {} : { port: Number(env["AUX_PORT"]) }),
    ...(env["AUX_HOST_TOKEN"] === undefined
      ? {}
      : { hostToken: env["AUX_HOST_TOKEN"] }),
    bridge: {
      ...bridge,
      ...(env["AUX_BRIDGE_IP"] === undefined
        ? {}
        : { ip: env["AUX_BRIDGE_IP"] }),
      ...(env["AUX_HUE_APP_KEY"] === undefined
        ? {}
        : { appKey: env["AUX_HUE_APP_KEY"] }),
    },
  };
  const parsed = configSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(
      `The aux config is invalid:\n${parsed.error.issues
        .map(
          (issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`,
        )
        .join("\n")}`,
    );
  }
  return parsed.data;
}

/** Reads the config file (`AUX_CONFIG`, else aux.config.json) and the env. */
export function loadConfig(env: Env): Config {
  const path = env["AUX_CONFIG"] ?? "aux.config.json";
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read ${path} (copy aux.config.example.json to start): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return parseConfig(raw, env);
}
