import type { PrState } from "./state.ts";

export const headerStart = "<!-- allthings:pr-header:start -->";
export const headerEnd = "<!-- allthings:pr-header:end -->";

// Night labels from the brand palette. Status colors read the same in light
// and dark GitHub themes and keep white badge text at 4.5:1 or better.
export const colors = {
  label: "1C1236",
  good: "276749",
  wait: "975A16",
  bad: "C0362C",
  info: "5B34D6",
  idle: "5E5A55",
} as const;

type Tone = Exclude<keyof typeof colors, "label">;

type Badge = {
  label: string;
  message: string;
  tone: Tone;
  href: string;
  logo?: string;
};

function badge({ label, message, tone, href, logo }: Badge): string {
  const params = new URLSearchParams({
    label,
    message,
    color: colors[tone],
    labelColor: colors.label,
    style: "flat-square",
  });
  if (logo) params.set("logo", logo);
  return `[![${label}: ${message}](https://img.shields.io/static/v1?${params})](${href})`;
}

export function changeStackUrl(pr: Pick<PrState, "repo" | "number">): string {
  return `https://app.coderabbit.ai/change-stack/${pr.repo.owner}/${pr.repo.name}/pull/${pr.number}`;
}

const preview = {
  ready: ["ready", "good"],
  building: ["building", "wait"],
  failed: ["failed", "bad"],
  none: ["none yet", "idle"],
} as const satisfies Record<
  PrState["preview"]["state"],
  readonly [string, Tone]
>;

const review = {
  approved: "good",
  "changes requested": "bad",
  reviewing: "wait",
  commented: "info",
  none: "idle",
} as const satisfies Record<PrState["coderabbit"]["review"], Tone>;

const checks = {
  passing: "good",
  failing: "bad",
  running: "wait",
  none: "idle",
} as const satisfies Record<PrState["checks"], Tone>;

const mergeStates = {
  clean: ["ready", "good"],
  blocked: ["blocked", "wait"],
  behind: ["behind main", "wait"],
  conflicts: ["conflicts", "bad"],
  unstable: ["checks not green", "wait"],
  checking: ["checking", "idle"],
  unknown: ["unknown", "idle"],
} as const satisfies Record<PrState["mergeState"], readonly [string, Tone]>;

function mergeBadge(pr: PrState): [string, Tone] {
  if (pr.state === "merged") return ["merged", "info"];
  if (pr.state === "closed") return ["closed", "idle"];
  if (pr.isDraft) return ["draft", "idle"];
  const [message, tone] = mergeStates[pr.mergeState];
  return [message, tone];
}

function findingsBadge({
  resolved,
  open,
}: PrState["coderabbit"]["findings"]): [string, Tone] {
  if (resolved + open === 0) return ["none", "idle"];
  return [`${resolved} resolved · ${open} open`, open > 0 ? "wait" : "good"];
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * The header for one pull request. It depends only on the PR's state, so the
 * same state always renders the same header and an unchanged PR is never
 * rewritten.
 */
export function renderHeader(pr: PrState, logo?: string): string {
  const previewUrl = pr.preview.url ?? pr.url;
  const [previewMessage, previewTone] = preview[pr.preview.state];
  const [findingsMessage, findingsTone] = findingsBadge(pr.coderabbit.findings);
  const [mergeMessage, mergeTone] = mergeBadge(pr);
  const badges = [
    badge({
      label: "preview",
      message: previewMessage,
      tone: previewTone,
      href: previewUrl,
      ...(logo ? { logo } : {}),
    }),
    badge({
      label: "coderabbit",
      message: pr.coderabbit.review,
      tone: review[pr.coderabbit.review],
      href: changeStackUrl(pr),
    }),
    badge({
      label: "findings",
      message: findingsMessage,
      tone: findingsTone,
      href: pr.url,
    }),
    badge({
      label: "checks",
      message: pr.checks,
      tone: checks[pr.checks],
      href: `${pr.url}/checks`,
    }),
    badge({
      label: "merge",
      message: mergeMessage,
      tone: mergeTone,
      href: pr.url,
    }),
  ];
  const { additions, deletions, files } = pr.diff;
  const links = [
    `[Preview](${previewUrl})`,
    `[Change Stack](${changeStackUrl(pr)})`,
    `[Checks](${pr.url}/checks)`,
    `[Files](${pr.url}/files): +${additions} −${deletions} in ${plural(files, "file")}`,
  ];
  return [
    headerStart,
    badges.join(" "),
    "",
    `<sub>${links.join(" · ")}</sub>`,
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
