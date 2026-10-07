import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageJson from "../package.json";
import { webBuildProblem, webDistFrom } from "../scripts/web-build.ts";

const missing =
  "web/dist/public is missing: run `bun run build` in web/ first (after `bun install` at the repository root)";

const made: Array<string> = [];
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A web/dist with `files` in it, each path relative to dist. */
function webDist(...files: ReadonlyArray<string>): string {
  const dist = mkdtempSync(join(tmpdir(), "web-dist-"));
  made.push(dist);
  for (const file of files) {
    mkdirSync(join(dist, file, ".."), { recursive: true });
    writeFileSync(join(dist, file), "");
  }
  return dist;
}

describe("webBuildProblem", () => {
  test("is nothing once web's build has written its assets and build.json", () => {
    expect(
      webBuildProblem(webDist("build.json", "public/assets/site.css")),
    ).toBeUndefined();
  });

  test("says to build web when anything the deploy reads is missing", () => {
    expect(webBuildProblem(join(webDist(), "not-built"))).toBe(missing);
    expect(webBuildProblem(webDist("build.json"))).toBe(missing);
    expect(webBuildProblem(webDist("public/assets/site.css"))).toBe(missing);
  });
});

describe("infra's plan and deploy", () => {
  test("check web's own dist, as a file path, even under a path with spaces", () => {
    expect(
      webDistFrom(
        "file:///Users/a%20b/allthingsweb/infra/scripts/web-build.ts",
      ),
    ).toBe("/Users/a b/allthingsweb/web/dist/");
  });

  test("check web's build before Alchemy runs", () => {
    for (const script of [
      packageJson.scripts.plan,
      packageJson.scripts.deploy,
    ]) {
      expect(script).toStartWith("bun scripts/web-build.ts && alchemy ");
    }
  });
});
