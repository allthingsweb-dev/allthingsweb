import { describe, expect, test } from "bun:test";
import { resolveOrigin } from "../src/lib/instance/origin";

const deploymentUrl = "allthingsweb-pgad927wl-andrelandgraf.vercel.app";

describe("public origin", () => {
  test("production advertises the production domain, never the protected deployment URL", () => {
    expect(
      resolveOrigin({
        port: 3000,
        vercelEnv: "production",
        vercelUrl: deploymentUrl,
        vercelProjectProductionUrl: "allthingsweb.dev",
      }),
    ).toBe("https://allthingsweb.dev");
  });

  test("preview deployments link to themselves", () => {
    expect(
      resolveOrigin({
        port: 3000,
        vercelEnv: "preview",
        vercelUrl: deploymentUrl,
        vercelProjectProductionUrl: "allthingsweb.dev",
      }),
    ).toBe(`https://${deploymentUrl}`);
  });

  test("outside Vercel the configured origin is used", () => {
    expect(
      resolveOrigin({ port: 3000, origin: "https://atw.example.com" }),
    ).toBe("https://atw.example.com");
  });

  test("local development falls back to localhost on the configured port", () => {
    expect(resolveOrigin({ port: 4321 })).toBe("http://localhost:4321");
  });
});
