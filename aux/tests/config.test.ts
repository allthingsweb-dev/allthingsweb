import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseConfig } from "../src/config.ts";
import { exampleConfig, testEnv } from "./support.ts";

const example = () =>
  JSON.parse(
    readFileSync(
      new URL("../aux.config.example.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;

describe("config", () => {
  test("the example is valid once its placeholders are filled in", () => {
    const config = exampleConfig();
    expect(config.startFrozen).toBe(true);
    expect(config.transitionMs).toBeGreaterThanOrEqual(1_500);
    expect(Object.keys(config.scenes)).toContain("house");
  });

  test("the example's placeholders are refused, so it never runs as is", () => {
    expect(() => parseConfig(example())).toThrow(
      /hostToken[\s\S]*bridge\.ip[\s\S]*bridge\.appKey/,
    );
  });

  test("the environment overrides the file", () => {
    const config = parseConfig(example(), { ...testEnv, AUX_PORT: "9999" });
    expect(config.port).toBe(9999);
    expect(config.bridge.ip).toBe(testEnv.AUX_BRIDGE_IP);
  });

  test("a host token longer than 256 characters is refused", () => {
    expect(() =>
      parseConfig(example(), { ...testEnv, AUX_HOST_TOKEN: "a".repeat(257) }),
    ).toThrow("32 to 256");
    const longest = parseConfig(example(), {
      ...testEnv,
      AUX_HOST_TOKEN: "a".repeat(256),
    });
    expect(longest.hostToken).toHaveLength(256);
  });

  test("a public Bridge address is refused", () => {
    expect(() =>
      parseConfig(example(), { ...testEnv, AUX_BRIDGE_IP: "8.8.8.8" }),
    ).toThrow("private IPv4");
  });

  test("a scene can't carry an effect, alert or brightness out of range", () => {
    const withEffect = example();
    withEffect["scenes"] = {
      party: { all: { color: "orange", brightness: 60, effect: "sparkle" } },
    };
    expect(() => parseConfig(withEffect, testEnv)).toThrow();
    const withAlert = example();
    withAlert["scenes"] = {
      party: { all: { color: "orange", brightness: 60 } },
      alert: "breathe",
    };
    expect(() => parseConfig(withAlert, testEnv)).toThrow();
    const tooBright = example();
    tooBright["scenes"] = {
      party: { all: { color: "orange", brightness: 100 } },
    };
    expect(() => parseConfig(tooBright, testEnv)).toThrow();
  });

  test("scenes name known zones and colors, three zones at most", () => {
    const unknown = example();
    unknown["scenes"] = {
      party: { roof: { color: "glitter", brightness: 60 } },
    };
    expect(() => parseConfig(unknown, testEnv)).toThrow(
      /zone "roof"[\s\S]*color "glitter"/,
    );
    const crowded = example();
    crowded["zones"] = { all: "a", b: "b", c: "c", d: "d" };
    crowded["scenes"] = {
      party: Object.fromEntries(
        ["all", "b", "c", "d"].map((zone) => [
          zone,
          { color: "orange", brightness: 60 },
        ]),
      ),
    };
    expect(() => parseConfig(crowded, testEnv)).toThrow("1 to 3 zones");
  });

  test("a fade under 1.5 s is refused", () => {
    expect(() =>
      parseConfig({ ...example(), transitionMs: 500 }, testEnv),
    ).toThrow("transitionMs");
  });

  test("music.player names afplay, mpv or pw-play, or is left out", () => {
    const raw = example();
    const music = raw["music"] as Record<string, unknown>;
    expect(parseConfig(raw, testEnv).music?.player).toBeUndefined();
    expect(
      parseConfig({ ...raw, music: { ...music, player: "mpv" } }, testEnv).music
        ?.player,
    ).toBe("mpv");
    expect(() =>
      parseConfig({ ...raw, music: { ...music, player: "vlc" } }, testEnv),
    ).toThrow("player");
  });
});
