import { describe, expect, test } from "bun:test";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import {
  Collaborator,
  INTAKE_ROLE,
  intakeReference,
  intakeUrl,
  Reader,
  roleOrigin,
} from "../src/reader.ts";
import * as Config from "effect/Config";

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

describe("the collaboration Hyperdrive's origin", () => {
  const collab = (value?: string) =>
    Effect.runSync(
      Effect.result(
        Collaborator.parse(
          ConfigProvider.fromUnknown(
            value === undefined ? {} : { NEON_COLLAB_URL: value },
          ),
        ),
      ),
    );

  test("is draft_collab, and nothing else", () => {
    const ok = collab(
      "postgres://draft_collab:pw@ep-x.neon.tech/neondb?sslmode=require",
    );
    expect(Result.isSuccess(ok)).toBe(true);
    for (const other of [
      "postgres://site_reader:pw@ep-x.neon.tech/neondb",
      "postgres://neondb_owner:pw@ep-x.neon.tech/neondb",
    ]) {
      const refused = collab(other);
      expect(Result.isFailure(refused)).toBe(true);
      expect(
        String(Result.isFailure(refused) ? refused.failure : ""),
      ).toContain(
        'NEON_COLLAB_URL must be for the collaboration "draft_collab" role',
      );
      expect(
        String(Result.isFailure(refused) ? refused.failure : ""),
      ).not.toContain("pw");
    }
    expect(Result.isFailure(collab())).toBe(true);
  });
});

describe("the intake Hyperdrive's origin", () => {
  const intake = (
    environment: Record<string, string>,
    vault: string | undefined,
    asked: Array<string> = [],
  ) =>
    Effect.runPromise(
      Effect.result(
        intakeUrl(async (reference) => {
          asked.push(reference);
          return vault;
        })
          .pipe(
            Config.mapEffect(
              roleOrigin("NEON_INTAKE_URL", INTAKE_ROLE, "intake"),
            ),
          )
          .parse(ConfigProvider.fromUnknown(environment)),
      ),
    );

  const url = "postgres://proposal_intake:pw@ep-x.neon.tech/neondb";

  test("is NEON_INTAKE_URL when the deploy sets it, and asks the vault nothing", async () => {
    const asked: Array<string> = [];
    const result = await intake({ NEON_INTAKE_URL: url }, undefined, asked);
    expect(Result.isSuccess(result) ? result.success.user : "").toBe(
      "proposal_intake",
    );
    expect(asked).toEqual([]);
  });

  test("is read from 1Password when it isn't set", async () => {
    const asked: Array<string> = [];
    const result = await intake({}, url, asked);
    expect(Result.isSuccess(result) ? result.success.user : "").toBe(
      "proposal_intake",
    );
    expect(asked).toEqual([intakeReference]);
  });

  test("fails a deploy that can read neither, and any other role, without saying the string", async () => {
    const neither = await intake({}, undefined);
    expect(Result.isFailure(neither) ? neither.failure.message : "").toContain(
      "NEON_INTAKE_URL is unset",
    );
    const other = await intake(
      { NEON_INTAKE_URL: "postgres://site_reader:pw@ep-x.neon.tech/neondb" },
      undefined,
    );
    const message = Result.isFailure(other) ? other.failure.message : "";
    expect(message).toContain('must be for the intake "proposal_intake" role');
    expect(message).not.toContain("pw");
  });
});
