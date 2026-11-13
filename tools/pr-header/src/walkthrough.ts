/**
 * CodeRabbit's walkthrough comment, read into the few things the header
 * repeats at the top of the description: the merge risk, the pre-merge
 * checks, and the walkthrough itself, with links to the Change Stack and to
 * the comment.
 *
 * The comment is CodeRabbit's text, so it is data: it is read by the markers
 * CodeRabbit puts around each section, and every piece is reduced to plain
 * text, escaped for Markdown and HTML and cut to a fixed length before the
 * header shows it. Nothing it says can add markup, links, images or mentions
 * to the description, and the whole section stays within `maxSectionLength`.
 */

export type Walkthrough = {
  /** The comment's address. */
  url: string;
  summary: string | null;
  changes: { area: string; files: string[]; summary: string }[];
  /** "4 (Complex) | ~45 minutes", as CodeRabbit puts it. */
  effort: string | null;
  mergeRisk: { level: string; upTo: string | null; reason: string } | null;
  securityRisk: { level: string; upTo: string | null } | null;
  checks: { name: string; status: string; explanation: string }[];
};

/** The marker that starts every CodeRabbit walkthrough comment. */
const walkthroughMarker = "<!-- walkthrough_start -->";

export const limits = {
  summary: 700,
  area: 120,
  changeSummary: 300,
  changes: 8,
  files: 5,
  file: 100,
  effort: 80,
  level: 20,
  reason: 900,
  checks: 10,
  checkName: 80,
  checkStatus: 20,
  explanation: 300,
} as const;

/** Every section the header renders is shorter than this, whatever the comment says. */
export const maxSectionLength = 20_000;

/** The text between CodeRabbit's `<!-- name_start -->` and `<!-- name_end -->`. */
function section(body: string, name: string): string | null {
  const start = body.indexOf(`<!-- ${name}_start -->`);
  if (start < 0) return null;
  const end = body.indexOf(`<!-- ${name}_end -->`, start);
  return end < 0 ? null : body.slice(start, end);
}

const entities: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Markup, comments and entities out; one line of words left. */
function words(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => entities[entity]!)
    .replace(/\s+/g, " ")
    .trim();
}

/** Cuts text between letters as people see them, never inside an emoji. */
const graphemes = new Intl.Segmenter();

/** Breaks a mention or a bare address without changing how it reads. */
const zeroWidthSpace = String.fromCharCode(0x200b);

/** How each character that could start markup is written instead. */
function escaped(char: string): string {
  if (char === "<") return "&lt;";
  if (char === ">") return "&gt;";
  if (char === "&") return "&amp;";
  if (char === "@") return `@${zeroWidthSpace}`;
  return /[\\*_[\]!|~#]/.test(char) ? `\\${char}` : char;
}

/**
 * Text CodeRabbit wrote, safe to set in Markdown: plain words with every
 * character that could start markup, a link, an image, a table cell or a
 * mention escaped, and no bare address GitHub would make a link. The result,
 * escapes included, is at most \`max\` characters long.
 */
export function plain(text: string, max: number): string {
  const line = words(text)
    // Its own emphasis and code marks carry no meaning once plain.
    .replace(/\*\*|__|`/g, "")
    .replace(/:\/\//g, `:/${zeroWidthSpace}/`)
    .replace(/\bwww\./gi, (www) => `${www.slice(0, 3)}${zeroWidthSpace}.`);
  // Nor may it start a list: "- a" is written \- a, and "1. a" 1\. a.
  const number = /^\d+(?=[.)])/.exec(line)?.[0] ?? "";
  const out: string[] = /^[-+]/.test(line) ? ["\\"] : number ? [number] : [];
  const rest = number ? `\\${line.slice(number.length)}` : line;
  let length = out.join("").length;
  const chars = Array.from(graphemes.segment(rest), ({ segment }) => segment);
  for (const [i, char] of chars.entries()) {
    const piece = number && i === 0 ? char : escaped(char);
    const room = i === chars.length - 1 ? max : max - 1;
    if (length + piece.length > room) {
      out.push("…");
      break;
    }
    out.push(piece);
    length += piece.length;
  }
  return out.join("").replace(/\s+…$/, "…");
}

/** A file path as a code span, or nothing if it isn't plainly a path. */
function file(path: string): string | null {
  const trimmed = path.trim();
  return /^[\w./@+-]+$/.test(trimmed) && trimmed.length <= limits.file
    ? `\`${trimmed}\``
    : null;
}

/** The cells of every Markdown table's body rows, headers left out. */
function rows(text: string): string[][] {
  const table = text
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
  const separator = (cells: string[] | undefined) =>
    cells !== undefined && cells.every((cell) => /^:?-+:?$/.test(cell));
  return table.filter(
    (cells, i) => !separator(cells) && !separator(table[i + 1]),
  );
}

/** The first paragraph of words, before any heading, list, table or code. */
function firstParagraph(text: string): string | null {
  for (const paragraph of text
    .replace(/<summary>[\s\S]*?<\/summary>/, "")
    .split(/\n\s*\n/)) {
    if (/^\s*(\*\*|\||#|```|<!--)/.test(paragraph)) {
      if (/^\s*(\*\*|\||#|```)/.test(paragraph)) return null;
      continue;
    }
    const line = words(paragraph);
    if (line) return line;
  }
  return null;
}

/** "**Merge Risk:** **⚪ Minimal** · up to `9e0bb`" → Minimal, 9e0bb. */
function risk(
  text: string | null,
  label: string,
): { level: string; upTo: string | null } | null {
  if (!text) return null;
  const match = new RegExp(
    `\\*\\*${label}:\\*\\*\\s*\\*\\*([^*]+)\\*\\*(?:\\s*·\\s*up to \`([0-9a-f]{5,40})\`)?`,
    "i",
  ).exec(text);
  if (!match) return null;
  const level = match[1]!.replace(/^[^\p{L}]+/u, "").trim();
  return level
    ? { level: plain(level, limits.level), upTo: match[2] ?? null }
    : null;
}

/** Reads CodeRabbit's walkthrough comment, or null if this isn't one. */
export function parseWalkthrough(
  body: string,
  url: string,
): Walkthrough | null {
  if (!body.includes(walkthroughMarker)) return null;

  const walk = section(body, "walkthrough") ?? "";
  const summary = firstParagraph(walk);
  const changes = rows(walk)
    .slice(0, limits.changes)
    .flatMap(([where, what]) => {
      if (!where || !what) return [];
      const [area = "", files = ""] = where.split(/<br\s*\/?>/i);
      return [
        {
          area: plain(area, limits.area),
          files: [...files.matchAll(/`([^`]+)`/g)]
            .map((m) => file(m[1]!))
            .filter((f): f is string => f !== null)
            .slice(0, limits.files),
          summary: plain(what, limits.changeSummary),
        },
      ];
    });
  const effort = /\*\*Estimated code review effort:\*\*\s*([^\n]+)/.exec(walk);

  const riskSection = section(body, "final_review_risk");
  const mergeRisk = risk(riskSection, "Merge Risk");
  const reason = riskSection
    ? plain(
        riskSection.replace(/<!-- final_review_risk_label[\s\S]*?-->/, ""),
        limits.reason,
      )
    : "";

  const checks = rows(section(body, "pre_merge_checks_walkthrough") ?? "")
    .slice(0, limits.checks)
    .flatMap(([name, status, explanation]) => {
      const alt = status ? /!\[([^\]]+)\]/.exec(status)?.[1] : undefined;
      if (!name || !alt) return [];
      return [
        {
          name: plain(name, limits.checkName),
          status: plain(alt, limits.checkStatus),
          explanation: plain(explanation ?? "", limits.explanation),
        },
      ];
    });

  return {
    url,
    summary: summary ? plain(summary, limits.summary) : null,
    changes,
    effort: effort ? plain(effort[1]!, limits.effort) : null,
    mergeRisk: mergeRisk ? { ...mergeRisk, reason } : null,
    securityRisk: risk(
      section(body, "architecture_review"),
      "Security architecture risk",
    ),
    checks,
  };
}

function checksLine(checks: Walkthrough["checks"]): string | null {
  if (checks.length === 0) return null;
  const counts = new Map<string, number>();
  for (const { status } of checks) {
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return [...counts]
    .map(([status, count]) => `${count} ${status.toLowerCase()}`)
    .join(", ");
}

/**
 * The CodeRabbit section under the header: the verdicts on one line, any
 * check that didn't pass spelled out, and the walkthrough folded away.
 */
export function renderWalkthrough(
  walkthrough: Walkthrough,
  changeStack: string,
): string {
  const { mergeRisk, securityRisk, checks } = walkthrough;
  const verdicts = [
    "**CodeRabbit**",
    ...(mergeRisk ? [`merge risk **${mergeRisk.level}**`] : []),
    ...(checks.length > 0
      ? [`pre-merge checks **${checksLine(checks)}**`]
      : []),
    `[Explain Change](${changeStack})`,
    `[full walkthrough](${walkthrough.url})`,
  ];
  const notPassed = checks
    .filter(({ status }) => status.toLowerCase() !== "passed")
    .map(
      ({ name, status, explanation }) =>
        `- **${name}**: ${status.toLowerCase()}. ${explanation}`,
    );

  const details: string[] = [];
  if (walkthrough.summary) details.push(walkthrough.summary);
  if (walkthrough.changes.length > 0) {
    details.push(
      [
        "| Change | Summary |",
        "| :--- | :--- |",
        ...walkthrough.changes.map(
          ({ area, files, summary }) =>
            `| **${area}**${files.length > 0 ? `<br>${files.join(", ")}` : ""} | ${summary} |`,
        ),
      ].join("\n"),
    );
  }
  if (walkthrough.effort) {
    details.push(`**Estimated review effort:** ${walkthrough.effort}`);
  }
  if (mergeRisk) {
    const upTo = mergeRisk.upTo
      ? `, up to \`${mergeRisk.upTo.slice(0, 7)}\``
      : "";
    details.push(
      `**Merge risk: ${mergeRisk.level}**${upTo}. ${mergeRisk.reason}`.trim(),
    );
  }
  if (securityRisk) {
    details.push(`**Security architecture risk: ${securityRisk.level}**`);
  }
  if (checks.length > 0) {
    details.push(
      [
        "| Pre-merge check | Status | Explanation |",
        "| :--- | :--- | :--- |",
        ...checks.map(
          ({ name, status, explanation }) =>
            `| ${name} | ${status} | ${explanation} |`,
        ),
      ].join("\n"),
    );
  }

  return [
    verdicts.join(" · "),
    ...(notPassed.length > 0 ? ["", ...notPassed] : []),
    "",
    "<details>",
    "<summary>Walkthrough, merge risk and pre-merge checks</summary>",
    "",
    details.join("\n\n"),
    "",
    "</details>",
  ].join("\n");
}
