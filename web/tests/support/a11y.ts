import { JSDOM } from "jsdom";

/**
 * axe-core's findings on a page's HTML, by WCAG 2.2 A and AA and axe's best
 * practices. jsdom lays nothing out, so the rules that need layout (color
 * contrast, target size) are left to the browser pass (web/README.md's QA
 * notes) and the brand's contrast tests; every other rule runs here.
 */

const axeSource = await Bun.file(
  new URL(import.meta.resolve("axe-core/axe.min.js")),
).text();

interface AxeResult {
  readonly violations: ReadonlyArray<{
    readonly id: string;
    readonly nodes: ReadonlyArray<{ readonly target: ReadonlyArray<string> }>;
  }>;
}

export async function axeProblems(html: string): Promise<Array<string>> {
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  try {
    dom.window.eval(axeSource);
    const axe = (
      dom.window as unknown as {
        axe: { run: (...args: Array<unknown>) => Promise<AxeResult> };
      }
    ).axe;
    const result = await axe.run(dom.window.document, {
      runOnly: [
        "wcag2a",
        "wcag2aa",
        "wcag21a",
        "wcag21aa",
        "wcag22aa",
        "best-practice",
      ],
      rules: {
        "color-contrast": { enabled: false },
        "target-size": { enabled: false },
      },
    });
    return result.violations.map(
      (violation) =>
        `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
    );
  } finally {
    dom.window.close();
  }
}
