import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VERCEL } from "../src/vercel-env.ts";

const infra = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { devDependencies: Record<string, string> };

describe("the Vercel CLI the env writes run", () => {
  test("is pinned to an exact version in infra's dependencies", () => {
    expect(pkg.devDependencies["vercel"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("is the installed one, by a path that's the same in every checkout", () => {
    const source = readFileSync(
      new URL("../src/vercel-env.ts", import.meta.url),
      "utf8",
    );
    // No command string starts the CLI through bunx (comments may name it).
    expect(source).not.toMatch(/["`']bunx /);
    // Every write pipes its value into the pinned CLI.
    expect(source).toMatch(/\| "\$\{VERCEL\}" env add/);
    // Relative to infra/, so Alchemy's stored command never names a checkout.
    expect(VERCEL).toBe("./node_modules/.bin/vercel");
    expect(existsSync(new URL(VERCEL, new URL("../", import.meta.url)))).toBe(
      true,
    );
  });

  test("answers as the pinned version, run from infra/", () => {
    const run = Bun.spawnSync([VERCEL, "--version"], {
      cwd: infra,
      env: { ...process.env, VERCEL_TELEMETRY_DISABLED: "1" },
    });
    expect(run.exitCode).toBe(0);
    expect(`${run.stdout.toString()}${run.stderr.toString()}`).toContain(
      pkg.devDependencies["vercel"]!,
    );
  });
});
