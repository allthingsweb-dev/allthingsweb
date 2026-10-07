import { describe, expect, test } from "bun:test";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import { Writer } from "../src/reader.ts";
import {
  APP_SYNC_CRON,
  cronsFor,
  requiredSecret,
  SYNC,
  syncPlan,
  uploadUrl,
  workerWrites,
} from "../src/sync.ts";
import { ALLTHINGS_ACCOUNT } from "../src/media.ts";

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
  test("runs hourly in dry-run, writing nothing beside the app's cron until the handover", () => {
    expect(SYNC.schedule).toBe("hourly");
    expect(cronsFor(SYNC.schedule)).toEqual(["0 * * * *"]);
    expect(SYNC.mode).toBe("dry-run");
    expect(workerWrites(SYNC)).toBe(false);
  });

  test("has no Cron Trigger when off", () => {
    expect(cronsFor("off")).toEqual([]);
  });

  test("runs at the top of every hour once on, as the app's cron does", () => {
    expect(cronsFor("hourly")).toEqual(["0 * * * *"]);
  });

  test("never writes while the app's cron on Vercel still does", async () => {
    const vercel = (await Bun.file(
      new URL("../../app/vercel.json", import.meta.url),
    ).json()) as { readonly crons?: ReadonlyArray<{ readonly path: string }> };
    const appWrites = (vercel.crons ?? []).some(
      (cron) => cron.path === APP_SYNC_CRON,
    );
    // Hand over in two pull requests: remove the app's cron first, then
    // set `mode: "write"` (infra/README.md, "The Luma sync").
    expect({ worker: workerWrites(SYNC), app: appWrites }).not.toEqual({
      worker: true,
      app: true,
    });
  });

  test("writes only on a schedule, in write mode", () => {
    expect(workerWrites({ schedule: "hourly", mode: "write" })).toBe(true);
    expect(workerWrites({ schedule: "hourly", mode: "dry-run" })).toBe(false);
    expect(workerWrites({ schedule: "off", mode: "write" })).toBe(false);
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

describe("requiredSecret", () => {
  /**
   * What `requiredSecret("LUMA_API_KEY")` makes of the environment variable
   * set to `value` (or unset), read as a deploy reads it.
   */
  const secret = (value?: string) =>
    Effect.runSync(
      Effect.result(
        requiredSecret("LUMA_API_KEY").parse(
          ConfigProvider.fromEnvRecord(
            value === undefined ? {} : { LUMA_API_KEY: value },
          ),
        ),
      ),
    );

  test("is the value, redacted", () => {
    const result = secret("luma-test-key");
    if (Result.isFailure(result)) throw new Error(result.failure.message);
    expect(Redacted.value(result.success)).toBe("luma-test-key");
  });

  test("fails the deploy when unset, empty or blank, naming the variable", () => {
    for (const value of [undefined, "", "   ", "\n"]) {
      const result = secret(value);
      if (Result.isSuccess(result)) {
        throw new Error(`accepted ${JSON.stringify(value)}`);
      }
      expect(result.failure.message).toContain("LUMA_API_KEY");
    }
    const blank = secret("   ");
    if (Result.isSuccess(blank)) throw new Error("accepted a blank key");
    expect(blank.failure.message).toContain("LUMA_API_KEY is empty");
  });
});

describe("syncPlan", () => {
  const pending = { id: "z", active: false };
  const active = { id: "z", active: true };

  test("runs the Sync Worker in the allthings account before the domain moves in, storing images through the upload Worker", () => {
    expect(syncPlan(ALLTHINGS_ACCOUNT, undefined)).toEqual({
      images: "upload",
    });
    expect(syncPlan(ALLTHINGS_ACCOUNT, pending)).toEqual({ images: "upload" });
  });

  test("stores images into its own bucket once allthings.dev is active there", () => {
    expect(syncPlan(ALLTHINGS_ACCOUNT, active)).toEqual({ images: "bucket" });
  });

  test("never runs it in another account, whatever its zone, so there is one Sync Worker", () => {
    expect(
      syncPlan("0123456789abcdef0123456789abcdef", active),
    ).toBeUndefined();
    expect(
      syncPlan("0123456789abcdef0123456789abcdef", undefined),
    ).toBeUndefined();
  });
});

describe("uploadUrl", () => {
  const read = (value?: string) =>
    Effect.runSync(
      Effect.result(
        uploadUrl.parse(
          ConfigProvider.fromEnvRecord(
            value === undefined ? {} : { MEDIA_UPLOAD_URL: value },
          ),
        ),
      ),
    );

  test("is the upload Worker's https URL", () => {
    for (const root of [
      "https://allthings-mediaupload-prod-x.example.workers.dev/",
      " https://allthings-mediaupload-prod-x.example.workers.dev ",
    ]) {
      const rooted = read(root);
      if (Result.isFailure(rooted)) throw new Error(rooted.failure.message);
    }
    const result = read(
      "https://allthings-mediaupload-prod-x.example.workers.dev",
    );
    if (Result.isFailure(result)) throw new Error(result.failure.message);
    expect(result.success).toBe(
      "https://allthings-mediaupload-prod-x.example.workers.dev",
    );
  });

  test("fails the deploy when unset, not https, or with anything after the host", () => {
    expect(Result.isFailure(read())).toBe(true);
    for (const value of [
      "http://upload.example",
      "upload.example",
      "  ",
      "https://upload.example.workers.dev/media",
      "https://upload.example.workers.dev/?key=a",
      "https://upload.example.workers.dev/#a",
    ]) {
      const result = read(value);
      if (Result.isSuccess(result)) throw new Error(`accepted ${value}`);
      expect(result.failure.message).toContain("MEDIA_UPLOAD_URL");
    }
  });
});
