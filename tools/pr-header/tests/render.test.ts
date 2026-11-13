import { describe, expect, test } from "bun:test";
import {
  changeStackUrl,
  headerEnd,
  headerStart,
  renderHeader,
  shieldUrl,
  withHeader,
} from "../src/render.ts";
import { explainChangeFile } from "../src/faces.ts";
import type { PrState } from "../src/state.ts";

const previewUrl = "https://allthings-web-pr-52-abc123.allthings.workers.dev";

const pr: PrState = {
  repo: { owner: "allthings-sf", name: "allthingsweb" },
  number: 52,
  url: "https://github.com/allthings-sf/allthingsweb/pull/52",
  state: "open",
  isDraft: false,
  mergeState: "clean",
  diff: { additions: 120, deletions: 30, files: 6 },
  preview: { state: "ready", url: previewUrl },
  coderabbit: {
    review: "approved",
    findings: { resolved: 5, open: 0 },
    walkthrough: null,
  },
  checks: "passing",
};

function badges(header: string) {
  return [...header.matchAll(/\[!\[([^\]]+)\]\(([^)]+)\)\]\(([^)]+)\)/g)].map(
    ([, alt, src, href]) => ({ alt, src: new URL(src!), href }),
  );
}

describe("the PR header", () => {
  test("shows every status as a linked badge, in a fixed order", () => {
    expect(
      badges(renderHeader(pr)).map(({ alt, href }) => [alt, href]),
    ).toEqual([
      ["preview: ready", previewUrl],
      ["coderabbit: approved", changeStackUrl(pr)],
      ["findings: all resolved", pr.url],
      ["checks: passing", `${pr.url}/checks`],
      ["merge: ready", pr.url],
    ]);
  });

  test("links the CodeRabbit Change Stack for the PR", () => {
    expect(changeStackUrl(pr)).toBe(
      "https://app.coderabbit.ai/change-stack/allthings-sf/allthingsweb/pull/52",
    );
  });

  test("links each badge to its drawn shield on main, versioned by its drawing", () => {
    for (const { src } of badges(renderHeader(pr))) {
      expect(src.origin + src.pathname).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/allthings-sf\/allthingsweb\/main\/tools\/pr-header\/shields\/[a-z0-9-]+\.svg$/,
      );
      expect(src.searchParams.get("v")).toMatch(/^[0-9a-f]{12}$/);
    }
    expect(badges(renderHeader(pr))[4]!.src.pathname).toEndWith(
      "/merge-ready.svg",
    );
  });

  test("refuses a face that has no drawn shield", () => {
    expect(() =>
      shieldUrl(pr.repo, { label: "merge", message: "on fire", tone: "bad" }),
    ).toThrow("No shield is drawn for merge-on-fire.svg");
  });

  test("counts open findings, and says when all are resolved", () => {
    const findings = (resolved: number, open: number) =>
      badges(
        renderHeader({
          ...pr,
          coderabbit: {
            review: "commented",
            findings: { resolved, open },
            walkthrough: null,
          },
        }),
      )[2]!.alt;
    expect(findings(5, 0)).toBe("findings: all resolved");
    expect(findings(1, 2)).toBe("findings: 2 open");
    expect(findings(0, 20)).toBe("findings: 20 open");
    expect(findings(0, 21)).toBe("findings: 20+ open");
  });

  test("summarizes the diff and the key links on one line", () => {
    expect(renderHeader(pr)).toContain(
      `<sub>[Preview](${previewUrl}) · [Change Stack](${changeStackUrl(pr)}) · Findings: 5 resolved, 0 open · [Checks](${pr.url}/checks) · [Files](${pr.url}/files): +120 −30 in 6 files</sub>`,
    );
  });

  test("falls back to the PR when there is no preview, and says so", () => {
    const header = renderHeader({
      ...pr,
      preview: { state: "none", url: null },
    });
    expect(badges(header)[0]).toMatchObject({
      alt: "preview: none yet",
      href: pr.url,
    });
  });

  test("reports merged, closed and draft PRs instead of a merge state", () => {
    const merge = (state: Partial<PrState>) =>
      badges(renderHeader({ ...pr, ...state }))[4]!.alt;
    expect(merge({ state: "merged" })).toBe("merge: merged");
    expect(merge({ state: "closed" })).toBe("merge: closed");
    expect(merge({ isDraft: true })).toBe("merge: draft");
    expect(merge({ mergeState: "behind" })).toBe("merge: behind main");
  });

  test("says when CodeRabbit has no findings yet", () => {
    const header = renderHeader({
      ...pr,
      coderabbit: {
        review: "none",
        findings: { resolved: 0, open: 0 },
        walkthrough: null,
      },
    });
    expect(badges(header)[2]!.alt).toBe("findings: none");
  });

  test("shows CodeRabbit's walkthrough under the shields once it exists", () => {
    expect(renderHeader(pr)).not.toContain("**CodeRabbit**");
    const header = renderHeader({
      ...pr,
      coderabbit: {
        ...pr.coderabbit,
        walkthrough: {
          url: `${pr.url}#issuecomment-1`,
          summary: "Adds a thing.",
          changes: [],
          effort: null,
          mergeRisk: { level: "Low", upTo: "abc1234", reason: "Small." },
          securityRisk: null,
          checkCounts: {},
          checks: [],
          omittedChecks: 0,
        },
      },
    });
    const [, inside] = header.split(headerStart);
    expect(inside).toContain(
      `**CodeRabbit** · merge risk **Low** · [![Explain Change](${shieldUrl(pr.repo, explainChangeFile)})](${changeStackUrl(pr)}) · [full walkthrough](${pr.url}#issuecomment-1)`,
    );
    expect(header.indexOf("**CodeRabbit**")).toBeGreaterThan(
      header.indexOf("<sub>"),
    );
    expect(header).toEndWith(`</details>\n${headerEnd}`);
  });

  test("renders the same state the same way every time", () => {
    expect(renderHeader(pr)).toBe(renderHeader(structuredClone(pr)));
  });
});

describe("placing the header", () => {
  const header = renderHeader(pr);

  test("puts it above the description", () => {
    expect(withHeader("## Why\n\nBecause.", header)).toBe(
      `${header}\n\n## Why\n\nBecause.`,
    );
    expect(withHeader(null, header)).toBe(header);
    expect(withHeader("", header)).toBe(header);
  });

  test("replaces an earlier header instead of stacking another", () => {
    const old = renderHeader({ ...pr, checks: "running" });
    const updated = withHeader(withHeader("Body", old), header);
    expect(updated).toBe(`${header}\n\nBody`);
    expect(updated.split(headerStart)).toHaveLength(2);
    expect(updated.split(headerEnd)).toHaveLength(2);
  });

  test("is stable once applied", () => {
    const once = withHeader("Body", header);
    expect(withHeader(once, header)).toBe(once);
  });
});
