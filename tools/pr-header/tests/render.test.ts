import { describe, expect, test } from "bun:test";
import {
  changeStackUrl,
  colors,
  headerEnd,
  headerStart,
  renderHeader,
  withHeader,
} from "../src/render.ts";
import type { PrState } from "../src/state.ts";

const pr: PrState = {
  repo: { owner: "allthingsweb-dev", name: "allthingsweb" },
  number: 52,
  url: "https://github.com/allthingsweb-dev/allthingsweb/pull/52",
  state: "open",
  isDraft: false,
  mergeState: "clean",
  diff: { additions: 120, deletions: 30, files: 6 },
  preview: { state: "ready", url: "https://allthings-pr-52.vercel.app" },
  coderabbit: { review: "approved", findings: { resolved: 5, open: 0 } },
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
      ["preview: ready", "https://allthings-pr-52.vercel.app"],
      ["coderabbit: approved", changeStackUrl(pr)],
      ["findings: 5 resolved · 0 open", pr.url],
      ["checks: passing", `${pr.url}/checks`],
      ["merge: ready", pr.url],
    ]);
  });

  test("links the CodeRabbit Change Stack for the PR", () => {
    expect(changeStackUrl(pr)).toBe(
      "https://app.coderabbit.ai/change-stack/allthingsweb-dev/allthingsweb/pull/52",
    );
  });

  test("colors badges by status on Night labels", () => {
    const params = (header: string) =>
      badges(header).map(({ src }) => src.searchParams.get("color"));
    expect(params(renderHeader(pr))).toEqual([
      "276749",
      "276749",
      "276749",
      "276749",
      "276749",
    ]);
    const troubled: PrState = {
      ...pr,
      mergeState: "conflicts",
      preview: { state: "failed", url: pr.preview.url },
      coderabbit: {
        review: "changes requested",
        findings: { resolved: 1, open: 2 },
      },
      checks: "failing",
    };
    expect(params(renderHeader(troubled))).toEqual([
      "C0362C",
      "C0362C",
      "975A16",
      "C0362C",
      "C0362C",
    ]);
    for (const { src } of badges(renderHeader(pr))) {
      expect(src.searchParams.get("labelColor")).toBe("1C1236");
    }
  });

  test("puts the brand mark on the first badge only", () => {
    const mark = "data:image/svg+xml;base64,PHN2Zy8+";
    expect(
      badges(renderHeader(pr, mark)).map(({ src }) =>
        src.searchParams.get("logo"),
      ),
    ).toEqual([mark, null, null, null, null]);
  });

  test("summarizes the diff and the key links on one line", () => {
    expect(renderHeader(pr)).toContain(
      `<sub>[Preview](https://allthings-pr-52.vercel.app) · [Change Stack](${changeStackUrl(pr)}) · [Checks](${pr.url}/checks) · [Files](${pr.url}/files): +120 −30 in 6 files</sub>`,
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
      coderabbit: { review: "none", findings: { resolved: 0, open: 0 } },
    });
    expect(badges(header)[2]!.alt).toBe("findings: none");
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

describe("badge colors", () => {
  const luminance = (hex: string) => {
    const [r, g, b] = [0, 2, 4].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };

  test.each(Object.entries(colors))(
    "%s keeps white badge text at WCAG 2.2 AA (4.5:1)",
    (_name, hex) => {
      expect(1.05 / (luminance(hex) + 0.05)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
