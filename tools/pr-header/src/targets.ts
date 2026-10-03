/** Which pull requests an event should refresh. */
export type Targets =
  | { kind: "numbers"; numbers: number[] }
  | { kind: "commit"; sha: string }
  | { kind: "all-open" };

type Payload = {
  pull_request?: { number: number };
  issue?: { number: number; pull_request?: unknown };
  check_run?: { head_sha: string; pull_requests: { number: number }[] };
  sha?: string;
  deployment?: { sha: string };
};

export function targetsFor(eventName: string, payload: Payload): Targets {
  switch (eventName) {
    case "pull_request_target":
    case "pull_request_review":
    case "pull_request_review_comment":
      return payload.pull_request
        ? { kind: "numbers", numbers: [payload.pull_request.number] }
        : { kind: "numbers", numbers: [] };
    case "issue_comment":
      // Comments on issues, not pull requests, have nothing to refresh.
      return payload.issue?.pull_request
        ? { kind: "numbers", numbers: [payload.issue.number] }
        : { kind: "numbers", numbers: [] };
    case "check_run": {
      const run = payload.check_run;
      if (!run) return { kind: "numbers", numbers: [] };
      // Fork PRs aren't listed on the run; find them by commit.
      return run.pull_requests.length > 0
        ? { kind: "numbers", numbers: run.pull_requests.map((pr) => pr.number) }
        : { kind: "commit", sha: run.head_sha };
    }
    case "status":
      return payload.sha
        ? { kind: "commit", sha: payload.sha }
        : { kind: "numbers", numbers: [] };
    case "deployment_status":
      return payload.deployment
        ? { kind: "commit", sha: payload.deployment.sha }
        : { kind: "numbers", numbers: [] };
    default:
      // schedule and workflow_dispatch refresh every open PR, which also
      // catches review threads resolved without an event of their own.
      return { kind: "all-open" };
  }
}
