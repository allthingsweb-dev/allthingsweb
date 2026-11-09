import { readFileSync } from "node:fs";
import { CodeBook } from "../src/codes.ts";
import { type Config, parseConfig } from "../src/config.ts";
import type { Hue } from "../src/hue.ts";
import { AuditLog } from "../src/log.ts";
import { Hub } from "../src/mcp.ts";
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

/** A Bridge that records each change, or fails when `failing` is set. */
export function fakeHue() {
  const changes: { id: string; command: LightCommand }[] = [];
  const state = { failing: false };
  const hue: Pick<Hue, "setGroupedLight"> = {
    async setGroupedLight(id, command) {
      if (state.failing) {
        throw new Error("The Bridge didn't answer within 4000 ms");
      }
      changes.push({ id, command });
    },
  };
  return { hue, changes, state };
}

/** A hub on a fake clock and Bridge, with three guest codes. */
export function testHub({ logPath }: { logPath?: string } = {}) {
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
    now: () => clock.now,
  });
  return { hub, clock, codes, guestCodes, bridge, log };
}
