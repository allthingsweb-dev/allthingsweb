import manifest from "../shields/manifest.json" with { type: "json" };
import {
  checks,
  explainChangeFile,
  faceFile,
  findingsFace,
  mergeFace,
  preview,
  review,
  type Face,
} from "./faces.ts";
import type { PrState } from "./state.ts";
import { renderWalkthrough } from "./walkthrough.ts";

export const headerStart = "<!-- allthings:pr-header:start -->";
export const headerEnd = "<!-- allthings:pr-header:end -->";

/**
 * Where a shield is served: the drawn file on main (src/shields.ts), at an
 * address that changes whenever the drawing does, so GitHub's image cache
 * never shows an old one.
 */
export function shieldUrl(
  repo: PrState["repo"],
  face: Face | typeof explainChangeFile,
): string {
  const file = typeof face === "string" ? face : faceFile(face);
  const version = (manifest as Record<string, string>)[file];
  if (!version) throw new Error(`No shield is drawn for ${file}`);
  return `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/main/tools/pr-header/shields/${file}?v=${version}`;
}

function shield(repo: PrState["repo"], face: Face, href: string): string {
  return `[![${face.label}: ${face.message}](${shieldUrl(repo, face)})](${href})`;
}

export function changeStackUrl(pr: Pick<PrState, "repo" | "number">): string {
  return `https://app.coderabbit.ai/change-stack/${pr.repo.owner}/${pr.repo.name}/pull/${pr.number}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * The header for one pull request. It depends only on the PR's state, so the
 * same state always renders the same header and an unchanged PR is never
 * rewritten.
 */
export function renderHeader(pr: PrState): string {
  const previewUrl = pr.preview.url ?? pr.url;
  const [previewMessage, previewTone] = preview[pr.preview.state];
  const [findingsMessage, findingsTone] = findingsFace(pr.coderabbit.findings);
  const [mergeMessage, mergeTone] = mergeFace(pr);
  const shields = [
    shield(
      pr.repo,
      { label: "preview", message: previewMessage, tone: previewTone },
      previewUrl,
    ),
    shield(
      pr.repo,
      {
        label: "coderabbit",
        message: pr.coderabbit.review,
        tone: review[pr.coderabbit.review],
      },
      changeStackUrl(pr),
    ),
    shield(
      pr.repo,
      { label: "findings", message: findingsMessage, tone: findingsTone },
      pr.url,
    ),
    shield(
      pr.repo,
      { label: "checks", message: pr.checks, tone: checks[pr.checks] },
      `${pr.url}/checks`,
    ),
    shield(
      pr.repo,
      { label: "merge", message: mergeMessage, tone: mergeTone },
      pr.url,
    ),
  ];
  const { additions, deletions, files } = pr.diff;
  const { resolved, open } = pr.coderabbit.findings;
  const links = [
    `[Preview](${previewUrl})`,
    `[Change Stack](${changeStackUrl(pr)})`,
    ...(resolved + open > 0
      ? [`Findings: ${resolved} resolved, ${open} open`]
      : []),
    `[Checks](${pr.url}/checks)`,
    `[Files](${pr.url}/files): +${additions} −${deletions} in ${plural(files, "file")}`,
  ];
  const { walkthrough } = pr.coderabbit;
  return [
    headerStart,
    shields.join(" "),
    "",
    `<sub>${links.join(" · ")}</sub>`,
    ...(walkthrough
      ? [
          "",
          renderWalkthrough(
            walkthrough,
            `[![Explain Change](${shieldUrl(pr.repo, explainChangeFile)})](${changeStackUrl(pr)})`,
          ),
        ]
      : []),
    headerEnd,
  ].join("\n");
}

/** Puts the header at the top of a PR description, replacing any old one. */
export function withHeader(body: string | null, header: string): string {
  const rest = (body ?? "")
    .replace(
      new RegExp(`${escape(headerStart)}[\\s\\S]*?${escape(headerEnd)}\\n*`),
      "",
    )
    .trimStart();
  return rest ? `${header}\n\n${rest}` : header;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
