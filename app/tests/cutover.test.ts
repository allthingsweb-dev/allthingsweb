import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";

/**
 * The cutover ships off: without ALLTHINGS_DEV_REDIRECT, the middleware
 * redirects nothing, and only pages learn their path, as before. Where it
 * sends each URL once on is web/tests/cutover.test.ts's to hold.
 */

delete process.env.ALLTHINGS_DEV_REDIRECT;
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
const { cutoverConfig } = await import("../src/lib/cutover/config");
const { middleware, config } = await import("../src/middleware");

const request = (path: string, method = "GET") =>
  new NextRequest(new URL(path, "https://allthingsweb.dev"), { method });

describe("the cutover, off", () => {
  test("is off unless the flag says on", () => {
    expect(cutoverConfig.redirectToAllthingsDev).toBe(false);
  });

  test("redirects nothing, and tells pages their path as before", async () => {
    for (const [path, method] of [
      ["/2025-01-28-all-things-web-at-sanity", "GET"],
      ["/about", "GET"],
      ["/mcp", "POST"],
      ["/api/v1/events", "GET"],
      ["/_next/image?url=x", "GET"],
    ] as const) {
      const response = await middleware(request(path, method));
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
      const passed = response.headers.get("x-middleware-request-x-pathname");
      expect(passed).toBe(
        path.startsWith("/api") || path.startsWith("/_next") ? null : path,
      );
    }
  });

  test("runs on every path, so the flag alone turns it on", () => {
    expect(config.matcher).toEqual(["/:path*"]);
  });
});
