import { describe, expect, test } from "bun:test";
import {
  fetchPullRequest,
  summarize,
  type GitHub,
  type PullRequestData,
} from "../src/github.ts";

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
          {
            author: { login: "coderabbitai" },
            state: "CHANGES_REQUESTED",
            body: "",
          },
          { author: { login: "esthor" }, state: "COMMENTED", body: "" },
          { author: { login: "coderabbitai" }, state: "APPROVED", body: "" },
          { author: { login: "coderabbitai" }, state: "COMMENTED", body: "" },
        ],
      },
    });
    expect(summarize(repo, pr, ready, null).coderabbit.review).toBe("approved");
  });

  test("shows CodeRabbit as reviewing while its check runs", () => {
    const pr = data({
      reviews: {
        nodes: [
          { author: { login: "coderabbitai" }, state: "APPROVED", body: "" },
        ],
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

describe("findings outside the diff", () => {
  const review = (state: string, body: string) => ({
    author: { login: "coderabbitai" },
    state,
    body,
  });

  test("count CodeRabbit's outside-diff comments from its latest review", () => {
    const pr = data({
      reviews: {
        nodes: [
          review("COMMENTED", "⚠️ Outside diff range comments (5)"),
          review(
            "CHANGES_REQUESTED",
            "Actionable comments posted: 1\n\n<summary>⚠️ Outside diff range comments (2)</summary>",
          ),
        ],
      },
      reviewThreads: { nodes: [thread("coderabbitai", false)] },
    });
    expect(summarize(repo, pr, ready, null).coderabbit.findings).toEqual({
      resolved: 0,
      open: 3,
    });
  });

  test("are cleared once CodeRabbit approves", () => {
    const pr = data({
      reviews: {
        nodes: [
          review("CHANGES_REQUESTED", "⚠️ Outside diff range comments (2)"),
          review("APPROVED", ""),
        ],
      },
    });
    expect(summarize(repo, pr, ready, null).coderabbit.findings.open).toBe(0);
  });
});

describe("loading a pull request", () => {
  test("follows review thread pages past the first hundred", async () => {
    const first = data({
      reviewThreads: {
        pageInfo: { hasNextPage: true, endCursor: "c1" },
        nodes: [thread("coderabbitai", true)],
      },
    });
    const calls: Record<string, unknown>[] = [];
    const github: GitHub = {
      rest: async () => {
        throw new Error("unused");
      },
      graphql: async <T>(
        _query: string,
        variables: Record<string, unknown>,
      ) => {
        calls.push(variables);
        if (!variables["after"])
          return { repository: { pullRequest: first } } as T;
        return {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  thread("coderabbitai", false),
                  thread("coderabbitai", false),
                ],
              },
            },
          },
        } as T;
      },
    };
    const pr = await fetchPullRequest(github, repo, 52);
    expect(pr.reviewThreads.nodes).toHaveLength(3);
    expect(calls.map((c) => c["after"] ?? null)).toEqual([null, "c1"]);
    expect(summarize(repo, pr, ready, null).coderabbit.findings).toEqual({
      resolved: 1,
      open: 2,
    });
  });
});
