import { readFileSync } from "node:fs";
import { CodeBook } from "../src/codes.ts";
import { type Config, parseConfig } from "../src/config.ts";
import type { Hue } from "../src/hue.ts";
import { AuditLog } from "../src/log.ts";
import { Hub } from "../src/mcp.ts";
import type { Track } from "../src/catalog.ts";
import type { Music, Spawn } from "../src/music.ts";
import type { LightCommand } from "../src/policy.ts";

/** Made-up values for the example config's placeholders. */
export const testEnv = {
  AUX_HOST_TOKEN: "host-token-for-tests-only-0123456789",
  AUX_BRIDGE_IP: "10.20.30.40",
  AUX_HUE_APP_KEY: "test-app-key-0123456789",
} as const;

/** The committed example config, its placeholders filled in. */
export function exampleConfig(): Config {
  const raw = JSON.parse(
    readFileSync(
      new URL("../aux.config.example.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;
  return parseConfig(raw, testEnv);
}

/**
 * A Bridge that records each change, or fails when `failing` is set. While
 * `gate` is set, each change waits for it; `started` counts changes begun.
 */
export function fakeHue() {
  const changes: { id: string; command: LightCommand }[] = [];
  const state: {
    failing: boolean;
    gate: Promise<void> | undefined;
    started: number;
  } = { failing: false, gate: undefined, started: 0 };
  const hue: Pick<Hue, "setGroupedLight"> = {
    async setGroupedLight(id, command) {
      state.started += 1;
      if (state.gate !== undefined) await state.gate;
      if (state.failing) {
        throw new Error("The Bridge didn't answer within 4000 ms");
      }
      changes.push({ id, command });
    },
  };
  return { hue, changes, state };
}

/** A hub on a fake clock and Bridge, with three guest codes, and `music` if given. */
export function testHub({
  logPath,
  music,
}: { logPath?: string; music?: Music } = {}) {
  const clock = { now: 1_000_000 };
  const codes = CodeBook.empty();
  const guestCodes = codes.generate(3);
  const bridge = fakeHue();
  const log = new AuditLog(logPath);
  const hub = new Hub({
    config: exampleConfig(),
    hue: bridge.hue,
    codes,
    log,
    ...(music === undefined ? {} : { music }),
    now: () => clock.now,
  });
  return { hub, clock, codes, guestCodes, bridge, log };
}

/** A track of the curated set, as loadPlaylist gives it. */
export function track(slug: string): Track {
  return {
    slug,
    title: `Title of ${slug}`,
    file: `/music/${slug}.mp3`,
    durationSeconds: 200,
  };
}

/** A player whose tracks end only when a test finishes or kills them. */
export function fakeSpawn() {
  const started: {
    file: string;
    volume: number;
    killed: boolean;
    finish: (code?: number) => void;
  }[] = [];
  const spawn: Spawn = (file, volume) => {
    let end: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      end = resolve;
    });
    const run = {
      file,
      volume,
      killed: false,
      finish: (code = 0) => end(code),
    };
    started.push(run);
    return {
      exited,
      kill: () => {
        run.killed = true;
        end(143);
      },
    };
  };
  return { spawn, started };
}

/** Lets the player's loop run up to its next wait. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
