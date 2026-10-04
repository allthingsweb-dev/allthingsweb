import { describe, expect, test } from "bun:test";
import { targetsFor } from "../src/targets.ts";

describe("which PRs an event refreshes", () => {
  test("PR, review and comment events name their PR", () => {
    expect(
      targetsFor("pull_request_target", { pull_request: { number: 7 } }),
    ).toEqual({
      kind: "numbers",
      numbers: [7],
    });
    expect(
      targetsFor("pull_request_review", { pull_request: { number: 8 } }),
    ).toEqual({
      kind: "numbers",
      numbers: [8],
    });
    expect(
      targetsFor("issue_comment", { issue: { number: 9, pull_request: {} } }),
    ).toEqual({ kind: "numbers", numbers: [9] });
  });

  test("comments on plain issues refresh nothing", () => {
    expect(targetsFor("issue_comment", { issue: { number: 3 } })).toEqual({
      kind: "numbers",
      numbers: [],
    });
  });

  test("check runs name their PRs, or their commit for fork PRs", () => {
    expect(
      targetsFor("check_run", {
        check_run: { head_sha: "abc", pull_requests: [{ number: 4 }] },
      }),
    ).toEqual({ kind: "numbers", numbers: [4] });
    expect(
      targetsFor("check_run", {
        check_run: { head_sha: "abc", pull_requests: [] },
      }),
    ).toEqual({ kind: "commit", sha: "abc" });
  });

  test("statuses and deployments are found by commit", () => {
    expect(targetsFor("status", { sha: "def" })).toEqual({
      kind: "commit",
      sha: "def",
    });
    expect(
      targetsFor("deployment_status", { deployment: { sha: "123" } }),
    ).toEqual({
      kind: "commit",
      sha: "123",
    });
  });

  test("the schedule and manual runs refresh every open PR", () => {
    expect(targetsFor("schedule", {})).toEqual({ kind: "all-open" });
    expect(targetsFor("workflow_dispatch", {})).toEqual({ kind: "all-open" });
  });
});
