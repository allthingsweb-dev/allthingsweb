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

/** The client sends JSON strings; any other body is a bug worth failing on. */
function jsonText(body: RequestInit["body"]): string {
  if (typeof body !== "string") throw new Error("Expected a JSON string body");
  return body;
}

function fakeVercel(
  routes: Record<string, { status: number; body?: unknown }>,
) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    expect(url.searchParams.get("teamId")).toBe("team_1");
    const method = init?.method ?? "GET";
    calls.push({
      method,
      path: url.pathname,
      ...(init?.body ? { body: JSON.parse(jsonText(init.body)) } : {}),
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

  test("never alias a deployment Vercel describes without an id", async () => {
    const { impl, calls } = fakeVercel({
      "GET /v13/deployments/odd.vercel.app": {
        status: 200,
        body: { projectId: "prj_1" },
      },
    });
    await expect(
      assignPreviewAlias(
        config,
        "https://odd.vercel.app",
        previewAlias(52),
        impl,
      ),
    ).rejects.toThrow("not a deployment of this project");
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  describe("are linked only when they point at the current deployment", () => {
    const current = "https://allthingsweb-new-team.vercel.app";
    const routes = (alias: { status: number; body?: unknown }) => ({
      "GET /v13/deployments/allthingsweb-new-team.vercel.app": {
        status: 200,
        body: { id: "dpl_new", projectId: "prj_1" },
      },
      "GET /v4/aliases/allthings-pr-52.vercel.app": alias,
    });

    test("linked when the alias targets this deployment", async () => {
      const { impl } = fakeVercel(
        routes({
          status: 200,
          body: { projectId: "prj_1", deploymentId: "dpl_new" },
        }),
      );
      expect(
        await stablePreviewUrl(config, previewAlias(52), current, impl),
      ).toBe("https://allthings-pr-52.vercel.app");
    });

    test("not linked while it still targets the previous deployment", async () => {
      const { impl } = fakeVercel(
        routes({
          status: 200,
          body: { projectId: "prj_1", deploymentId: "dpl_old" },
        }),
      );
      expect(
        await stablePreviewUrl(config, previewAlias(52), current, impl),
      ).toBeNull();
    });

    test("not linked when missing, another project's, or there is no deployment", async () => {
      expect(
        await stablePreviewUrl(
          config,
          previewAlias(52),
          current,
          fakeVercel(routes({ status: 404 })).impl,
        ),
      ).toBeNull();
      expect(
        await stablePreviewUrl(
          config,
          previewAlias(52),
          current,
          fakeVercel(
            routes({
              status: 200,
              body: { projectId: "prj_other", deploymentId: "dpl_new" },
            }),
          ).impl,
        ),
      ).toBeNull();
      const { impl, calls } = fakeVercel({});
      expect(
        await stablePreviewUrl(config, previewAlias(52), null, impl),
      ).toBeNull();
      expect(calls).toEqual([]);
    });

    test("not linked when neither response names a deployment id", async () => {
      const { impl } = fakeVercel({
        "GET /v13/deployments/allthingsweb-new-team.vercel.app": {
          status: 200,
          body: { projectId: "prj_1" },
        },
        "GET /v4/aliases/allthings-pr-52.vercel.app": {
          status: 200,
          body: { projectId: "prj_1" },
        },
      });
      expect(
        await stablePreviewUrl(config, previewAlias(52), current, impl),
      ).toBeNull();
    });
  });
});
