import { describe, expect, test } from "bun:test";
import { SITE_HOST, SITE_ORIGIN, siteDomain } from "../src/web.ts";

describe("the site's domain", () => {
  test("is allthings.dev, the origin every stage names", () => {
    expect(SITE_HOST).toBe("allthings.dev");
    expect(SITE_ORIGIN).toBe("https://allthings.dev");
  });

  test("serves the apex and 301s www to it, in the given zone", () => {
    expect(siteDomain("zone-id")).toEqual({
      name: "allthings.dev",
      redirects: ["www.allthings.dev"],
      zoneId: "zone-id",
    });
  });
});
