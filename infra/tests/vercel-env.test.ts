import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { VERCEL } from "../src/vercel-env.ts";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { devDependencies: Record<string, string> };

describe("the Vercel CLI the env writes run", () => {
  test("is pinned to an exact version in infra's dependencies", () => {
    expect(pkg.devDependencies["vercel"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("is the installed one, never fetched by bunx at each write", () => {
    const source = readFileSync(
      new URL("../src/vercel-env.ts", import.meta.url),
      "utf8",
    );
    // No command string starts the CLI through bunx (comments may name it).
    expect(source).not.toMatch(/["`']bunx /);
    // Every write pipes its value into the pinned CLI.
    expect(source).toMatch(/\| "\$\{VERCEL\}" env add/);
    expect(VERCEL.endsWith("/node_modules/.bin/vercel")).toBe(true);
    expect(existsSync(VERCEL)).toBe(true);
  });

  test("answers as the pinned version", () => {
    const run = Bun.spawnSync([VERCEL, "--version"], {
      env: { ...process.env, VERCEL_TELEMETRY_DISABLED: "1" },
    });
    expect(run.exitCode).toBe(0);
    expect(`${run.stdout.toString()}${run.stderr.toString()}`).toContain(
      pkg.devDependencies["vercel"]!,
    );
  });
});
