import { describe, expect, test } from "bun:test";
import { installers } from "../scripts/build.ts";
import { cliCommands } from "../src/links.ts";

/**
 * The CLI's installers and their addresses. The site serves them at
 * allthings.dev (scripts/build.ts; pages.test.ts fetches them from the
 * Worker); the GitHub Pages copies in pages/ only run those, so the links
 * to Pages keep working until the organization's rename ends them.
 */

const origin = "https://allthings.dev";

const read = (path: string) =>
  Bun.file(new URL(`../../${path}`, import.meta.url)).text();

/** The `curl … | bash` lines a script runs. */
const curls = (script: string) =>
  script
    .split("\n")
    .filter((line) => line.startsWith("curl "))
    .map((line) => line.trim());

describe("the CLI's installers", () => {
  test("are /install.bash and /atw-install.bash, from cli/", () => {
    expect(installers).toEqual([
      ["install.bash", "cli/install.bash"],
      ["atw-install.bash", "cli/atw-install.bash"],
    ]);
  });

  test("are installed from allthings.dev, as the about page and the CLI's README say", async () => {
    expect(cliCommands.install).toBe(
      `curl -fsSL ${origin}/install.bash | bash`,
    );
    expect(await read("cli/install.bash")).toContain(
      `\n#   ${cliCommands.install}\n`,
    );
  });

  test("the old name's runs /install.bash", async () => {
    expect(curls(await read("cli/atw-install.bash"))).toEqual([
      cliCommands.install,
    ]);
  });

  test("on GitHub Pages, each runs the one of its name on allthings.dev, and nothing else", async () => {
    for (const [published] of installers) {
      expect(curls(await read(`pages/${published}`))).toEqual([
        `curl -fsSL ${origin}/${published} | bash`,
      ]);
    }
  });

  test("are bash that parses", async () => {
    const scripts = [
      ...installers.map(([, source]) => source),
      ...installers.map(([published]) => `pages/${published}`),
    ];
    for (const script of scripts) {
      const check = Bun.spawnSync(["bash", "-n", script], {
        cwd: new URL("../..", import.meta.url).pathname,
        stderr: "pipe",
      });
      expect(`${script}: ${check.stderr.toString()}`).toBe(`${script}: `);
      expect(check.exitCode).toBe(0);
    }
  });
});
