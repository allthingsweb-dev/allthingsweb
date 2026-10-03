/** Everything the header shows about one pull request, already summarized. */
export type PrState = {
  repo: { owner: string; name: string };
  number: number;
  url: string;
  state: "open" | "merged" | "closed";
  isDraft: boolean;
  mergeState:
    | "clean"
    | "blocked"
    | "behind"
    | "conflicts"
    | "unstable"
    | "checking"
    | "unknown";
  diff: { additions: number; deletions: number; files: number };
  preview: {
    state: "ready" | "building" | "failed" | "none";
    /** The PR's stable alias when one is set up, else the latest deployment. */
    url: string | null;
  };
  coderabbit: {
    review:
      "approved" | "changes requested" | "reviewing" | "commented" | "none";
    findings: { resolved: number; open: number };
  };
  checks: "passing" | "failing" | "running" | "none";
};
