import { describe, expect, test } from "bun:test";
import { ALLTHINGS_ACCOUNT, productionRole } from "../src/media.ts";

const personal = "0123456789abcdef0123456789abcdef";

describe("productionRole", () => {
  test("serves wherever allthings.dev is active", () => {
    expect(productionRole(personal, { id: "z", active: true })).toBe("serve");
    expect(productionRole(ALLTHINGS_ACCOUNT, { id: "z", active: true })).toBe(
      "serve",
    );
  });

  test("only stages the bucket in the allthings account until the domain is active there", () => {
    expect(productionRole(ALLTHINGS_ACCOUNT, undefined)).toBe("stage");
    expect(productionRole(ALLTHINGS_ACCOUNT, { id: "z", active: false })).toBe(
      "stage",
    );
  });

  test("refuses an account the domain has left", () => {
    expect(productionRole(personal, undefined)).toBeInstanceOf(Error);
    expect(productionRole(personal, { id: "z", active: false })).toBeInstanceOf(
      Error,
    );
  });
});
