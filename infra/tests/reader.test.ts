import { describe, expect, test } from "bun:test";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import { Reader } from "../src/reader.ts";

const secret = "s3cr%2Ft";

/** What `Reader` makes of `NEON_READER_URL` set to `value` (or unset). */
const read = (value?: string) =>
  Effect.runSync(
    Effect.result(
      Reader.parse(
        ConfigProvider.fromUnknown(
          value === undefined ? {} : { NEON_READER_URL: value },
        ),
      ),
    ),
  );

/** The message a rejected `NEON_READER_URL` fails with. */
const rejection = (value?: string) => {
  const result = read(value);
  if (Result.isSuccess(result)) throw new Error("expected a rejection");
  return result.failure.message;
};

describe("Reader", () => {
  test("is the site_reader role as a Hyperdrive origin", () => {
    const result = read(
      `postgresql://site_reader:${secret}@ep-x.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`,
    );
    if (Result.isFailure(result)) throw new Error(result.failure.message);
    const { password, ...origin } = result.success;
    expect(origin).toEqual({
      scheme: "postgres",
      host: "ep-x.us-east-2.aws.neon.tech",
      database: "neondb",
      user: "site_reader",
    });
    expect(Redacted.value(password)).toBe("s3cr/t");
  });

  test("keeps an explicit port", () => {
    const result = read(`postgres://site_reader:${secret}@db.example:6543/app`);
    expect(Result.isSuccess(result) && result.success.port).toBe(6543);
  });

  for (const [label, value, reason] of [
    ["the owner role", `postgres://neondb_owner:${secret}@h/neondb`, "role"],
    [
      "Neon's reader role, which can write",
      `postgres://reader:${secret}@h/neondb`,
      "role",
    ],
    ["no password", "postgres://site_reader@h/neondb", "password"],
    ["no database", `postgres://site_reader:${secret}@h`, "database"],
    ["another scheme", `mysql://reader:${secret}@h/neondb`, "postgres://"],
    ["not a URL", "reader", "not a URL"],
  ] as const) {
    test(`rejects ${label}, without repeating it`, () => {
      const message = rejection(value);
      expect(message).toContain(reason);
      expect(message).not.toContain(secret);
    });
  }

  test("fails when NEON_READER_URL is unset", () => {
    expect(rejection()).toContain("NEON_READER_URL");
  });
});
