import { JSDOM } from "jsdom";

/**
 * axe-core's findings on a page's HTML, by WCAG 2.2 A and AA and axe's best
 * practices: its violations, and the checks it could not decide. jsdom lays
 * nothing out, so the rules that need layout are off (color contrast, target
 * size: the brand's APCA tests and the browser pass cover them), and two
 * that need visibility are undecidable here and checked by the caller
 * instead (`decidedElsewhere`). Any other undecided check is a problem, so
 * a page never passes only because axe couldn't tell.
 */

const axeSource = await Bun.file(
  new URL(import.meta.resolve("axe-core/axe.min.js")),
).text();

interface AxeRule {
  readonly id: string;
  readonly nodes: ReadonlyArray<{ readonly target: ReadonlyArray<string> }>;
}

interface AxeResult {
  readonly violations: ReadonlyArray<AxeRule>;
  readonly incomplete: ReadonlyArray<AxeRule>;
}

/**
 * Checks jsdom can't decide, as it computes no visibility, which the page
 * tests make themselves: one <main>, and one <h1>.
 */
export const decidedElsewhere: ReadonlySet<string> = new Set([
  "landmark-one-main",
  "page-has-heading-one",
]);

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
    const describe = (prefix: string) => (rule: AxeRule) =>
      `${prefix}${rule.id}: ${rule.nodes.map((node) => node.target.join(" ")).join(", ")}`;
    return [
      ...result.violations.map(describe("")),
      ...result.incomplete
        .filter((rule) => !decidedElsewhere.has(rule.id))
        .map(describe("undecided ")),
    ];
  } finally {
    dom.window.close();
  }
}
