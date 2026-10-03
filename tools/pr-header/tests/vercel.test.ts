import { describe, expect, test } from "bun:test";
import {
  assignPreviewAlias,
  previewAlias,
  stablePreviewUrl,
  type VercelConfig,
} from "../src/vercel.ts";

const config: VercelConfig = {
  token: "t",
  teamId: "team_1",
  projectId: "prj_1",
};

function fakeVercel(
  routes: Record<string, { status: number; body?: unknown }>,
) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.searchParams.get("teamId")).toBe("team_1");
    const method = init?.method ?? "GET";
    calls.push({
      method,
      path: url.pathname,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    const route = routes[`${method} ${url.pathname}`];
    if (!route) throw new Error(`Unexpected ${method} ${url.pathname}`);
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status,
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe("stable preview aliases", () => {
  test("are named after the PR", () => {
    expect(previewAlias(52)).toBe("allthings-pr-52.vercel.app");
  });

  test("point the PR's alias at the given deployment of this project", async () => {
    const { impl, calls } = fakeVercel({
      "GET /v13/deployments/allthingsweb-abc-team.vercel.app": {
        status: 200,
        body: { id: "dpl_1", projectId: "prj_1" },
      },
      "POST /v2/deployments/dpl_1/aliases": { status: 200, body: {} },
    });
    await assignPreviewAlias(
      config,
      "https://allthingsweb-abc-team.vercel.app",
      previewAlias(52),
      impl,
    );
    expect(calls.at(-1)).toEqual({
      method: "POST",
      path: "/v2/deployments/dpl_1/aliases",
      body: { alias: "allthings-pr-52.vercel.app" },
    });
  });

  test("never alias another project's deployment", async () => {
    const { impl, calls } = fakeVercel({
      "GET /v13/deployments/other.vercel.app": {
        status: 200,
        body: { id: "dpl_2", projectId: "prj_other" },
      },
    });
    await expect(
      assignPreviewAlias(
        config,
        "https://other.vercel.app",
        previewAlias(52),
        impl,
      ),
    ).rejects.toThrow("not a deployment of this project");
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  test("are linked only once they exist and belong to this project", async () => {
    const ours = fakeVercel({
      "GET /v4/aliases/allthings-pr-52.vercel.app": {
        status: 200,
        body: { projectId: "prj_1" },
      },
    });
    expect(await stablePreviewUrl(config, previewAlias(52), ours.impl)).toBe(
      "https://allthings-pr-52.vercel.app",
    );
    const missing = fakeVercel({
      "GET /v4/aliases/allthings-pr-52.vercel.app": { status: 404 },
    });
    expect(
      await stablePreviewUrl(config, previewAlias(52), missing.impl),
    ).toBeNull();
    const theirs = fakeVercel({
      "GET /v4/aliases/allthings-pr-52.vercel.app": {
        status: 200,
        body: { projectId: "prj_other" },
      },
    });
    expect(
      await stablePreviewUrl(config, previewAlias(52), theirs.impl),
    ).toBeNull();
  });
});
