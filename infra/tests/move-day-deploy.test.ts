import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";

const INFRA = new URL("../", import.meta.url);

/**
 * Every setting the stack reads from the environment: each `Config.String`,
 * `Config.Redacted` and `requiredSecret` name in alchemy.run.ts and src/.
 */
async function stackSettings(): Promise<ReadonlySet<string>> {
  const files = [
    new URL("alchemy.run.ts", INFRA),
    ...(await readdir(new URL("src/", INFRA)))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => new URL(`src/${name}`, INFRA)),
  ];
  const names = new Set<string>();
  for (const file of files) {
    const source = await Bun.file(file).text();
    for (const match of source.matchAll(
      /(?:Config\.(?:String|Redacted)|requiredSecret)\("([A-Z0-9_]+)"\)/g,
    )) {
      names.add(match[1]!);
    }
  }
  return names;
}

/** The names move-day-deploy.sh exports to the deploy. */
async function exported(): Promise<ReadonlySet<string>> {
  const script = await Bun.file(
    new URL("scripts/move-day-deploy.sh", INFRA),
  ).text();
  return new Set(
    [...script.matchAll(/^export ([A-Z0-9_ ]+)$/gm)].flatMap((match) =>
      match[1]!.trim().split(/\s+/),
    ),
  );
}

describe("move-day-deploy.sh", () => {
  test("finds the stack's settings", async () => {
    expect(await stackSettings()).toContain("NEON_READER_URL");
  });

  test("exports every setting the stack reads, so its plan can't fail on move day", async () => {
    const names = await exported();
    expect(
      [...(await stackSettings())].filter((name) => !names.has(name)),
    ).toEqual([]);
  });
});
