import { describe, expect, test } from "bun:test";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { Writer } from "../src/reader.ts";
import { cronsFor, SYNC } from "../src/sync.ts";

/** What `Writer` makes of `NEON_SYNC_URL` set to `value` (or unset). */
const write = (value?: string) =>
  Effect.runSync(
    Effect.result(
      Writer.parse(
        ConfigProvider.fromUnknown(
          value === undefined ? {} : { NEON_SYNC_URL: value },
        ),
      ),
    ),
  );

describe("the sync Worker", () => {
  test("has no Cron Trigger and writes nothing until the cutover turns it on", () => {
    expect(SYNC.schedule).toBe("off");
    expect(cronsFor(SYNC.schedule)).toEqual([]);
    expect(SYNC.mode).toBe("dry-run");
  });

  test("runs at the top of every hour once on, as the app's cron does", () => {
    expect(cronsFor("hourly")).toEqual(["0 * * * *"]);
  });
});

describe("Writer", () => {
  test("is the site_sync role as a Hyperdrive origin", () => {
    const result = write("postgresql://site_sync:pw@ep-x.neon.tech/neondb");
    if (Result.isFailure(result)) throw new Error(result.failure.message);
    expect(result.success).toMatchObject({
      host: "ep-x.neon.tech",
      database: "neondb",
      user: "site_sync",
    });
  });

  test("refuses any other role, and says which variable without its value", () => {
    for (const user of ["site_reader", "neondb_owner", "reader"]) {
      const result = write(`postgres://${user}:hunter2@h/neondb`);
      if (Result.isSuccess(result)) throw new Error(`accepted ${user}`);
      expect(result.failure.message).toContain(
        'NEON_SYNC_URL must be for the sync\'s "site_sync" role',
      );
      expect(result.failure.message).not.toContain("hunter2");
    }
  });

  test("is required when it is planned", () => {
    expect(Result.isFailure(write())).toBe(true);
  });
});
