import { describe, expect, test } from "bun:test";
import {
  limits,
  maxSectionLength,
  parseWalkthrough,
  plain,
  renderWalkthrough,
} from "../src/walkthrough.ts";

// CodeRabbit's walkthrough comment on #429, cut after its finishing touches.
const comment = await Bun.file(
  new URL("fixtures/walkthrough.md", import.meta.url),
).text();
const url =
  "https://github.com/allthings-sf/allthings/pull/429#issuecomment-6864449249";
// The Explain Change shield's Markdown, as the header renders it.
const explain =
  "[![Explain Change](https://example.com/explain.svg)](https://app.coderabbit.ai/change-stack/allthings-sf/allthings/pull/429)";

describe("reading CodeRabbit's walkthrough", () => {
  const walkthrough = parseWalkthrough(comment, url)!;

  test("finds the summary, the changes and the effort", () => {
    expect(walkthrough.summary).toStartWith(
      "The PR adds a monthly letter system",
    );
    expect(walkthrough.changes.map(({ area }) => area)).toEqual([
      "Issue structure and content validation",
      "Source checks, publication, and edit tracking",
      "CLI commands and issue registry",
    ]);
    expect(walkthrough.changes[0]!.files).toEqual([
      "`core/src/letter.ts`",
      "`core/tests/letter.test.ts`",
    ]);
    expect(walkthrough.effort).toBe("4 (Complex) \\| \\~45 minutes");
  });

  test("finds the merge and security risks", () => {
    expect(walkthrough.mergeRisk).toMatchObject({
      level: "Minimal",
      upTo: "9e0bb",
    });
    expect(walkthrough.mergeRisk!.reason).toStartWith(
      "The monthly letter workflow adds validation",
    );
    expect(walkthrough.securityRisk).toEqual({
      level: "Minimal",
      upTo: "9e0bb",
    });
  });

  test("finds every pre-merge check and its status", () => {
    expect(
      walkthrough.checks.map(({ name, status }) => [name, status]),
    ).toEqual([
      ["Description Check", "passed"],
      ["Title check", "passed"],
      ["Linked Issues check", "passed"],
      ["Out of Scope Changes check", "passed"],
    ]);
  });

  test("ignores any other comment", () => {
    expect(parseWalkthrough("Thanks, looks good!", url)).toBeNull();
    expect(
      parseWalkthrough("<!-- review_stack_entry_start -->", url),
    ).toBeNull();
  });

  test("keeps what it can when CodeRabbit leaves sections out", () => {
    const bare = parseWalkthrough(
      "<!-- walkthrough_start -->\n\nJust a summary.\n\n<!-- walkthrough_end -->",
      url,
    );
    expect(bare).toEqual({
      url,
      summary: "Just a summary.",
      changes: [],
      effort: null,
      mergeRisk: null,
      securityRisk: null,
      checkCounts: {},
      checks: [],
      omittedChecks: 0,
    });
  });
});

describe("the CodeRabbit section", () => {
  const section = renderWalkthrough(parseWalkthrough(comment, url)!, explain);

  test("puts the verdicts and links on one line", () => {
    expect(section.split("\n")[0]).toBe(
      `**CodeRabbit** · merge risk **Minimal** · pre-merge checks **4 passed** · ${explain} · [full walkthrough](${url})`,
    );
  });

  test("folds the walkthrough, the risk and the checks away", () => {
    expect(section).toContain(
      "<details>\n<summary>Walkthrough, merge risk and pre-merge checks</summary>",
    );
    expect(section).toContain(
      "| **CLI commands and issue registry**<br>`core/letters/index.ts`",
    );
    expect(section).toContain("**Merge risk: Minimal**, up to `9e0bb`.");
    expect(section).toContain("| Title check | passed |");
    expect(section).toEndWith("</details>");
  });

  test("spells out a check that didn't pass, outside the fold", () => {
    const failing = comment.replace(
      /(\|\s*Title check\s*\|\s*)!\[Passed\]/,
      "$1![Failed]",
    );
    expect(failing).not.toBe(comment);
    const rendered = renderWalkthrough(
      parseWalkthrough(failing, url)!,
      explain,
    );
    expect(rendered).toContain("pre-merge checks **3 passed, 1 failed**");
    const [beforeFold] = rendered.split("<details>");
    expect(beforeFold).toContain("- **Title check**: failed. The title names");
  });

  test("counts every check, and shows those that didn't pass first", () => {
    const row = (name: string, status: string) =>
      `| ${name} | ![${status}](https://example.com/x.svg) | Why. |`;
    const body = [
      "<!-- walkthrough_start -->\n\nA change.\n\n<!-- walkthrough_end -->",
      "<!-- pre_merge_checks_walkthrough_start -->",
      "| Check name | Status | Explanation |",
      "| :--- | :---: | :--- |",
      ...Array.from({ length: limits.checks }, (_, i) =>
        row(`Check ${i}`, "Passed"),
      ),
      row("Late check", "Failed"),
      "<!-- pre_merge_checks_walkthrough_end -->",
    ].join("\n");
    const walkthrough = parseWalkthrough(body, url)!;
    expect(walkthrough.checkCounts).toEqual({
      passed: limits.checks,
      failed: 1,
    });
    expect(walkthrough.checks).toHaveLength(limits.checks);
    expect(walkthrough.checks[0]).toMatchObject({
      name: "Late check",
      status: "failed",
    });
    expect(walkthrough.omittedChecks).toBe(1);
    const rendered = renderWalkthrough(walkthrough, explain);
    expect(rendered).toContain(
      `pre-merge checks **${limits.checks} passed, 1 failed**`,
    );
    expect(rendered.split("<details>")[0]).toContain(
      "- **Late check**: failed. Why.",
    );
    expect(rendered).toContain(
      `And 1 more pre-merge checks in the [full walkthrough](${url}).`,
    );
  });

  test("renders the same comment the same way every time", () => {
    expect(renderWalkthrough(parseWalkthrough(comment, url)!, explain)).toBe(
      section,
    );
  });
});

describe("CodeRabbit's text is data", () => {
  test("can't add markup, links, images, cells or mentions", () => {
    const text = plain(
      'Hi @erik <img src=x onerror="alert(1)"> [click](https://evil.example) ![x](https://evil.example/x.png) a | b `code` **bold** www.evil.example &lt;b&gt;',
      1000,
    );
    expect(text).not.toMatch(/<[a-z]/i);
    expect(text).not.toMatch(/(^|[^\\])[[\]|!]/);
    expect(text).not.toContain("https://");
    expect(text).not.toMatch(/www\./);
    expect(text).not.toMatch(/@[a-z]/);
    expect(text).toContain("&lt;b&gt;");
  });

  test("can't start a list or heading", () => {
    expect(plain("- item", 100)).toBe("\\- item");
    expect(plain("1. item", 100)).toBe("1\\. item");
    expect(plain("# Heading", 100)).toBe("\\# Heading");
  });

  test("is cut to its limit, escapes included", () => {
    for (const text of [
      "word ".repeat(500),
      "<".repeat(500),
      `${"1".repeat(25_000)}. summary`,
      `- ${"x".repeat(500)}`,
    ]) {
      const cut = plain(text, 50);
      expect(cut.length).toBeLessThanOrEqual(50);
      expect(cut).toEndWith("…");
    }
  });

  test("keeps only plain file paths", () => {
    const hostile = comment.replace(
      "`core/tests/letter.test.ts`|Defines",
      "`core/tests/letter.test.ts`, `x](https://evil.example)`|Defines",
    );
    expect(hostile).not.toBe(comment);
    expect(parseWalkthrough(hostile, url)!.changes[0]!.files).toEqual([
      "`core/src/letter.ts`",
      "`core/tests/letter.test.ts`",
    ]);
  });

  test("never makes the section longer than its bound", () => {
    const huge = (n: number) => "x".repeat(n);
    const rows = Array.from(
      { length: 50 },
      () =>
        `|**${huge(5000)}** <br> ${Array.from({ length: 20 }, () => `\`${"a".repeat(99)}\``).join(", ")}|${huge(5000)}|`,
    ).join("\n");
    const checks = Array.from(
      { length: 50 },
      () => `| ${huge(5000)} | ![${huge(500)}](x) | ${huge(5000)} |`,
    ).join("\n");
    const body = [
      "<!-- walkthrough_start -->",
      "",
      `${"1".repeat(25_000)}. ${huge(50_000)}`,
      "",
      "|Layer / File(s)|Summary|",
      "|:---|:---|",
      rows,
      "",
      `**Estimated code review effort:** ${huge(5000)}`,
      "<!-- walkthrough_end -->",
      "<!-- final_review_risk_start -->",
      `<!-- final_review_risk_label\n**Merge Risk:** **⚪ ${huge(5000)}** · up to \`9e0bb\`\n-->`,
      huge(50_000),
      "<!-- final_review_risk_end -->",
      "<!-- pre_merge_checks_walkthrough_start -->",
      "| Check name | Status | Explanation |",
      "| :--- | :---: | :--- |",
      checks,
      "<!-- pre_merge_checks_walkthrough_end -->",
    ].join("\n");
    const walkthrough = parseWalkthrough(body, url)!;
    expect(walkthrough.changes).toHaveLength(limits.changes);
    expect(walkthrough.checks).toHaveLength(limits.checks);
    expect(renderWalkthrough(walkthrough, explain).length).toBeLessThanOrEqual(
      maxSectionLength,
    );
  });
});
