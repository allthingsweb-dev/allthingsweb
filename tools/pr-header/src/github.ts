import type { PrState } from "./state.ts";

export type Repo = PrState["repo"];

export type GitHub = {
  graphql: <T>(query: string, variables: Record<string, unknown>) => Promise<T>;
  rest: <T>(
    method: "GET" | "PATCH",
    path: string,
    body?: unknown,
  ) => Promise<T>;
};

export function createGitHub(token: string, fetchImpl = fetch): GitHub {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "allthings-pr-header",
  };
  async function send<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetchImpl(url, { ...init, headers });
    if (!response.ok) {
      throw new Error(
        `GitHub ${init.method} ${url}: ${response.status} ${await response.text()}`,
      );
    }
    return (await response.json()) as T;
  }
  return {
    graphql: async <T>(query: string, variables: Record<string, unknown>) => {
      const result = await send<{ data?: T; errors?: { message: string }[] }>(
        "https://api.github.com/graphql",
        { method: "POST", body: JSON.stringify({ query, variables }) },
      );
      if (result.errors?.length || !result.data) {
        throw new Error(
          `GitHub GraphQL: ${result.errors?.map((e) => e.message).join("; ")}`,
        );
      }
      return result.data;
    },
    rest: <T>(method: "GET" | "PATCH", path: string, body?: unknown) =>
      send<T>(`https://api.github.com${path}`, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
  };
}

export const pullRequestQuery = `
  query ($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        number url state isDraft mergeStateStatus headRefOid body
        additions deletions changedFiles
        reviews(last: 50) { nodes { author { login } state } }
        reviewThreads(first: 100) {
          nodes { isResolved comments(first: 1) { nodes { author { login } } } }
        }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                contexts(first: 100) {
                  nodes {
                    __typename
                    ... on CheckRun { name status conclusion }
                    ... on StatusContext { context state }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

type Context =
  | {
      __typename: "CheckRun";
      name: string;
      status: string;
      conclusion: string | null;
    }
  | { __typename: "StatusContext"; context: string; state: string };

export type PullRequestData = {
  number: number;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  mergeStateStatus: string;
  headRefOid: string;
  body: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviews: { nodes: { author: { login: string } | null; state: string }[] };
  reviewThreads: {
    nodes: {
      isResolved: boolean;
      comments: { nodes: { author: { login: string } | null }[] };
    }[];
  };
  commits: {
    nodes: {
      commit: {
        statusCheckRollup: { contexts: { nodes: Context[] } } | null;
      };
    }[];
  };
};

/** The newest Vercel preview deployment of the PR's head commit. */
export type PreviewDeployment = {
  state: string;
  url: string | null;
} | null;

const coderabbit = "coderabbitai";

function contextName(context: Context): string {
  return context.__typename === "CheckRun" ? context.name : context.context;
}

function contextOutcome(context: Context): "passed" | "failed" | "running" {
  if (context.__typename === "StatusContext") {
    if (context.state === "SUCCESS") return "passed";
    if (context.state === "FAILURE" || context.state === "ERROR")
      return "failed";
    return "running";
  }
  if (context.status !== "COMPLETED") return "running";
  return ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(context.conclusion ?? "")
    ? "passed"
    : "failed";
}

// Shown in their own badges, or this workflow itself.
const separateChecks = /^(CodeRabbit|Vercel|PR header)/;

const mergeStates: Record<string, PrState["mergeState"]> = {
  CLEAN: "clean",
  HAS_HOOKS: "clean",
  BLOCKED: "blocked",
  BEHIND: "behind",
  DIRTY: "conflicts",
  UNSTABLE: "unstable",
  UNKNOWN: "checking",
};

/** Turns GitHub's view of a PR into the header's state. Pure, for testing. */
export function summarize(
  repo: Repo,
  pr: PullRequestData,
  deployment: PreviewDeployment,
  stablePreviewUrl: string | null,
): PrState {
  const contexts =
    pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];

  const coderabbitCheck = contexts.find((c) => contextName(c) === "CodeRabbit");
  const decisive = pr.reviews.nodes
    .filter((r) => r.author?.login === coderabbit)
    .map((r) => r.state);
  const lastDecision = decisive.findLast(
    (state) => state === "APPROVED" || state === "CHANGES_REQUESTED",
  );
  const review: PrState["coderabbit"]["review"] =
    coderabbitCheck && contextOutcome(coderabbitCheck) === "running"
      ? "reviewing"
      : lastDecision === "APPROVED"
        ? "approved"
        : lastDecision === "CHANGES_REQUESTED"
          ? "changes requested"
          : decisive.length > 0
            ? "commented"
            : "none";

  const threads = pr.reviewThreads.nodes.filter(
    (t) => t.comments.nodes[0]?.author?.login === coderabbit,
  );
  const resolved = threads.filter((t) => t.isResolved).length;

  const outcomes = contexts
    .filter((c) => !separateChecks.test(contextName(c)))
    .map(contextOutcome);
  const checks: PrState["checks"] =
    outcomes.length === 0
      ? "none"
      : outcomes.includes("failed")
        ? "failing"
        : outcomes.includes("running")
          ? "running"
          : "passing";

  const previewState: PrState["preview"]["state"] = !deployment
    ? "none"
    : deployment.state === "success"
      ? "ready"
      : deployment.state === "failure" || deployment.state === "error"
        ? "failed"
        : "building";

  return {
    repo,
    number: pr.number,
    url: pr.url,
    state:
      pr.state === "OPEN"
        ? "open"
        : pr.state === "MERGED"
          ? "merged"
          : "closed",
    isDraft: pr.isDraft,
    mergeState: mergeStates[pr.mergeStateStatus] ?? "unknown",
    diff: {
      additions: pr.additions,
      deletions: pr.deletions,
      files: pr.changedFiles,
    },
    preview: {
      state: previewState,
      url: deployment ? (stablePreviewUrl ?? deployment.url) : null,
    },
    coderabbit: {
      review,
      findings: { resolved, open: threads.length - resolved },
    },
    checks,
  };
}

/** The newest preview deployment for a commit, from Vercel's GitHub records. */
export async function previewDeployment(
  github: GitHub,
  repo: Repo,
  sha: string,
): Promise<PreviewDeployment> {
  const deployments = await github.rest<{ id: number }[]>(
    "GET",
    `/repos/${repo.owner}/${repo.name}/deployments?sha=${sha}&environment=Preview&per_page=1`,
  );
  const latest = deployments[0];
  if (!latest) return null;
  const statuses = await github.rest<
    { state: string; environment_url?: string }[]
  >(
    "GET",
    `/repos/${repo.owner}/${repo.name}/deployments/${latest.id}/statuses?per_page=1`,
  );
  const status = statuses[0];
  return {
    state: status?.state ?? "pending",
    url: status?.environment_url || null,
  };
}
