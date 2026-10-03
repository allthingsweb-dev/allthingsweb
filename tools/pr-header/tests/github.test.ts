import { describe, expect, test } from "bun:test";
import { summarize, type PullRequestData } from "../src/github.ts";

const repo = { owner: "allthingsweb-dev", name: "allthingsweb" };

function data(overrides: Partial<PullRequestData> = {}): PullRequestData {
  return {
    number: 52,
    url: "https://github.com/allthingsweb-dev/allthingsweb/pull/52",
    state: "OPEN",
    isDraft: false,
    mergeStateStatus: "CLEAN",
    headRefOid: "abc123",
    body: "Body",
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    reviews: { nodes: [] },
    reviewThreads: { nodes: [] },
    commits: {
      nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [] } } } }],
    },
    ...overrides,
  };
}

const ready = {
  state: "success",
  url: "https://allthingsweb-abc-team.vercel.app",
};

function thread(login: string, isResolved: boolean) {
  return { isResolved, comments: { nodes: [{ author: { login } }] } };
}

function checkRun(name: string, status: string, conclusion: string | null) {
  return { __typename: "CheckRun" as const, name, status, conclusion };
}

function contexts(...nodes: ReturnType<typeof checkRun>[]) {
  return {
    nodes: [{ commit: { statusCheckRollup: { contexts: { nodes } } } }],
  };
}

describe("summarizing a pull request", () => {
  test("uses CodeRabbit's latest decision, not an earlier one", () => {
    const pr = data({
      reviews: {
        nodes: [
          { author: { login: "coderabbitai" }, state: "CHANGES_REQUESTED" },
          { author: { login: "esthor" }, state: "COMMENTED" },
          { author: { login: "coderabbitai" }, state: "APPROVED" },
          { author: { login: "coderabbitai" }, state: "COMMENTED" },
        ],
      },
    });
    expect(summarize(repo, pr, ready, null).coderabbit.review).toBe("approved");
  });

  test("shows CodeRabbit as reviewing while its check runs", () => {
    const pr = data({
      reviews: {
        nodes: [{ author: { login: "coderabbitai" }, state: "APPROVED" }],
      },
      commits: contexts(checkRun("CodeRabbit", "IN_PROGRESS", null)),
    });
    expect(summarize(repo, pr, ready, null).coderabbit.review).toBe(
      "reviewing",
    );
  });

  test("counts only CodeRabbit's review threads as findings", () => {
    const pr = data({
      reviewThreads: {
        nodes: [
          thread("coderabbitai", true),
          thread("coderabbitai", true),
          thread("coderabbitai", false),
          thread("esthor", false),
        ],
      },
    });
    expect(summarize(repo, pr, ready, null).coderabbit.findings).toEqual({
      resolved: 2,
      open: 1,
    });
  });

  test("judges checks without CodeRabbit, Vercel or this header's own run", () => {
    const passing = data({
      commits: contexts(
        checkRun("🧪 Tests", "COMPLETED", "SUCCESS"),
        checkRun("CodeRabbit", "IN_PROGRESS", null),
        checkRun("Vercel", "COMPLETED", "FAILURE"),
        checkRun("PR header", "IN_PROGRESS", null),
      ),
    });
    expect(summarize(repo, passing, ready, null).checks).toBe("passing");
    const failing = data({
      commits: contexts(
        checkRun("🧪 Tests", "COMPLETED", "FAILURE"),
        checkRun("🧪 CLI", "IN_PROGRESS", null),
      ),
    });
    expect(summarize(repo, failing, ready, null).checks).toBe("failing");
    const running = data({
      commits: contexts(checkRun("🧪 CLI", "QUEUED", null)),
    });
    expect(summarize(repo, running, ready, null).checks).toBe("running");
    expect(summarize(repo, data(), ready, null).checks).toBe("none");
  });

  test("links the stable preview when there is one, else the deployment", () => {
    const stable = "https://allthings-pr-52.vercel.app";
    expect(summarize(repo, data(), ready, stable).preview).toEqual({
      state: "ready",
      url: stable,
    });
    expect(summarize(repo, data(), ready, null).preview.url).toBe(ready.url);
    expect(summarize(repo, data(), null, stable).preview).toEqual({
      state: "none",
      url: null,
    });
    expect(
      summarize(repo, data(), { state: "in_progress", url: null }, null).preview
        .state,
    ).toBe("building");
    expect(
      summarize(repo, data(), { state: "error", url: null }, null).preview
        .state,
    ).toBe("failed");
  });

  test("maps GitHub's merge states", () => {
    const merge = (mergeStateStatus: string) =>
      summarize(repo, data({ mergeStateStatus }), ready, null).mergeState;
    expect(merge("CLEAN")).toBe("clean");
    expect(merge("DIRTY")).toBe("conflicts");
    expect(merge("BEHIND")).toBe("behind");
    expect(merge("UNKNOWN")).toBe("checking");
    expect(merge("SOMETHING_NEW")).toBe("unknown");
  });
});
