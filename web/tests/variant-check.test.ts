import { describe, expect, test } from "bun:test";
import {
  checkVariantStore,
  type StoredVariant,
  type VariantStore,
} from "../src/images/kept.ts";

/** A bucket in memory, and what was done to it. */
const memoryStore = (
  options: {
    readonly losesWrites?: boolean;
    readonly keepsDeletes?: boolean;
  } = {},
) => {
  const objects = new Map<string, Uint8Array>();
  const done: Array<string> = [];
  const store: VariantStore = {
    async get(key): Promise<StoredVariant | null> {
      done.push(`get ${key}`);
      const bytes = objects.get(key);
      return bytes === undefined
        ? null
        : {
            body: new Response(bytes).body!,
            httpMetadata: { contentType: "text/plain" },
          };
    },
    async put(key, value) {
      done.push(`put ${key}`);
      if (options.losesWrites !== true) {
        objects.set(
          key,
          new Uint8Array(await new Response(value).arrayBuffer()),
        );
      }
    },
    async delete(key) {
      done.push(`delete ${key}`);
      if (options.keepsDeletes !== true) objects.delete(key);
    },
  };
  return { store, objects, done };
};

describe("checkVariantStore", () => {
  test("stores one object under deploy-checks/, reads it back, deletes it and finds it gone", async () => {
    const { store, objects, done } = memoryStore();
    const { checked } = await checkVariantStore(store);
    expect(checked).toMatch(/^deploy-checks\/[0-9a-f-]{36}\.txt$/);
    expect(done).toEqual([
      `put ${checked}`,
      `get ${checked}`,
      `delete ${checked}`,
      `get ${checked}`,
    ]);
    expect(objects.size).toBe(0);
  });

  test("fails when the object doesn't read back, and deletes it anyway", async () => {
    const { store, done } = memoryStore({ losesWrites: true });
    await expect(checkVariantStore(store)).rejects.toThrow("didn't read back");

    expect(done.some((step) => step.startsWith("delete "))).toBe(true);
  });

  test("fails when the object survives its delete", async () => {
    const { store } = memoryStore({ keepsDeletes: true });
    await expect(checkVariantStore(store)).rejects.toThrow("still there");
  });
});
