import { describe, expect, test } from "bun:test";
import {
  fetchPullRequest,
  summarize,
  type GitHub,
  type PullRequestData,
} from "../src/github.ts";

const repo = { owner: "allthings-sf", name: "allthings" };

function data(overrides: Partial<PullRequestData> = {}): PullRequestData {
  return {
    number: 52,
    url: "https://github.com/allthings-sf/allthings/pull/52",
    state: "OPEN",
    isDraft: false,
    mergeStateStatus: "CLEAN",
    headRefOid: "abc123",
    body: "Body",
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    reviews: { nodes: [] },
    comments: { nodes: [] },
    reviewThreads: { nodes: [] },
    commits: {
      nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [] } } } }],
    },
    ...overrides,
  };
}

const ready = {
  state: "success",
  url: "https://allthings-web-pr-52-abc123.allthings.workers.dev",
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
    expect(summarize(repo, pr, ready).coderabbit.review).toBe("approved");
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
    expect(summarize(repo, pr, ready).coderabbit.review).toBe("reviewing");
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
    expect(summarize(repo, pr, ready).coderabbit.findings).toEqual({
      resolved: 2,
      open: 1,
    });
  });

  test("judges checks without CodeRabbit or this header's own run", () => {
    const passing = data({
      commits: contexts(
        checkRun("🧪 Tests", "COMPLETED", "SUCCESS"),
        checkRun("CodeRabbit", "IN_PROGRESS", null),
        checkRun("PR header", "IN_PROGRESS", null),
      ),
    });
    expect(summarize(repo, passing, ready).checks).toBe("passing");
    const failing = data({
      commits: contexts(
        checkRun("🧪 Tests", "COMPLETED", "FAILURE"),
        checkRun("🧪 CLI", "IN_PROGRESS", null),
      ),
    });
    expect(summarize(repo, failing, ready).checks).toBe("failing");
    const running = data({
      commits: contexts(checkRun("🧪 CLI", "QUEUED", null)),
    });
    expect(summarize(repo, running, ready).checks).toBe("running");
    expect(summarize(repo, data(), ready).checks).toBe("none");
  });

  test("links the latest preview deployment", () => {
    expect(summarize(repo, data(), ready).preview).toEqual({
      state: "ready",
      url: ready.url,
    });
    expect(summarize(repo, data(), null).preview).toEqual({
      state: "none",
      url: null,
    });
    expect(
      summarize(repo, data(), { state: "in_progress", url: null }).preview
        .state,
    ).toBe("building");
    expect(
      summarize(repo, data(), { state: "error", url: null }).preview.state,
    ).toBe("failed");
  });

  test("maps GitHub's merge states", () => {
    const merge = (mergeStateStatus: string) =>
      summarize(repo, data({ mergeStateStatus }), ready).mergeState;
    expect(merge("CLEAN")).toBe("clean");
    expect(merge("DIRTY")).toBe("conflicts");
    expect(merge("BEHIND")).toBe("behind");
    expect(merge("UNKNOWN")).toBe("checking");
    expect(merge("SOMETHING_NEW")).toBe("unknown");
  });

  test("reads CodeRabbit's walkthrough comment, and no one else's", () => {
    const walkthrough =
      "<!-- walkthrough_start -->\n\nAdds a thing.\n\n<!-- walkthrough_end -->";
    const comment = (login: string, body: string, n: number) => ({
      author: { login },
      url: `https://github.com/allthings-sf/allthingsweb/pull/52#issuecomment-${n}`,
      body,
    });
    const read = (nodes: ReturnType<typeof comment>[]) =>
      summarize(repo, data({ comments: { nodes } }), ready).coderabbit
        .walkthrough;
    expect(read([])).toBeNull();
    expect(read([comment("someone", walkthrough, 1)])).toBeNull();
    expect(
      read([
        comment("someone", walkthrough, 1),
        comment("coderabbitai", "Review triggered.", 2),
        comment("coderabbitai", walkthrough, 3),
      ]),
    ).toMatchObject({
      url: "https://github.com/allthings-sf/allthingsweb/pull/52#issuecomment-3",
      summary: "Adds a thing.",
    });
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
    expect(summarize(repo, pr, ready).coderabbit.findings).toEqual({
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
    expect(summarize(repo, pr, ready).coderabbit.findings.open).toBe(0);
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
    expect(summarize(repo, pr, ready).coderabbit.findings).toEqual({
      resolved: 1,
      open: 2,
    });
  });

  test("follows comment pages until it finds CodeRabbit's walkthrough", async () => {
    const comment = (login: string, body: string) => ({
      author: { login },
      url: "https://github.com/allthings-sf/allthingsweb/pull/52#issuecomment-1",
      body,
    });
    const walkthrough =
      "<!-- walkthrough_start -->\n\nAdds a thing.\n\n<!-- walkthrough_end -->";
    const pages = [
      {
        pageInfo: { hasNextPage: true, endCursor: "p2" },
        nodes: [comment("someone", "Hi")],
      },
      {
        pageInfo: { hasNextPage: true, endCursor: "p3" },
        nodes: [comment("coderabbitai", walkthrough)],
      },
    ];
    const cursors: unknown[] = [];
    const github: GitHub = {
      rest: async () => {
        throw new Error("unused");
      },
      graphql: async <T>(query: string, variables: Record<string, unknown>) => {
        if (!variables["after"])
          return {
            repository: { pullRequest: data({ comments: pages[0]! }) },
          } as T;
        expect(query).toContain("comments(first: 20, after: $after)");
        cursors.push(variables["after"]);
        return {
          repository: { pullRequest: { comments: pages[1]! } },
        } as T;
      },
    };
    const pr = await fetchPullRequest(github, repo, 52);
    // It stops at the page with the walkthrough, though more follow.
    expect(cursors).toEqual(["p2"]);
    expect(summarize(repo, pr, ready).coderabbit.walkthrough?.summary).toBe(
      "Adds a thing.",
    );
  });

  test("stops when a comment page hands back the cursor it was asked for", async () => {
    const stuck = {
      pageInfo: { hasNextPage: true, endCursor: "p2" },
      nodes: [
        {
          author: { login: "someone" },
          url: "https://github.com/allthings-sf/allthingsweb/pull/52#issuecomment-1",
          body: "Hi",
        },
      ],
    };
    let requests = 0;
    const github: GitHub = {
      rest: async () => {
        throw new Error("unused");
      },
      graphql: async <T>(
        _query: string,
        variables: Record<string, unknown>,
      ) => {
        requests += 1;
        return (
          variables["after"]
            ? { repository: { pullRequest: { comments: stuck } } }
            : { repository: { pullRequest: data({ comments: stuck }) } }
        ) as T;
      },
    };
    await expect(fetchPullRequest(github, repo, 52)).rejects.toThrow(
      "#52: comment pages stopped advancing at p2",
    );
    // The first page, then the one that repeated its cursor.
    expect(requests).toBe(2);
  });
});
