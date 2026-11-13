import type { PrState } from "./state.ts";

/**
 * What each shield in the header can say. Every state of a pull request maps
 * to one of a fixed set of faces, so each face is drawn once, ahead of time
 * (src/shields.ts), and the header only links to it.
 */

export type Tone = "good" | "wait" | "bad" | "info" | "idle";

/** The five shields, in the order the header shows them. */
export const labels = [
  "preview",
  "coderabbit",
  "findings",
  "checks",
  "merge",
] as const;
export type Label = (typeof labels)[number];

export type Face = { label: Label; message: string; tone: Tone };

export const preview = {
  ready: ["ready", "good"],
  building: ["building", "wait"],
  failed: ["failed", "bad"],
  none: ["none yet", "idle"],
} as const satisfies Record<
  PrState["preview"]["state"],
  readonly [string, Tone]
>;

export const review = {
  approved: "good",
  "changes requested": "bad",
  reviewing: "wait",
  commented: "info",
  none: "idle",
} as const satisfies Record<PrState["coderabbit"]["review"], Tone>;

export const checks = {
  passing: "good",
  failing: "bad",
  running: "wait",
  none: "idle",
} as const satisfies Record<PrState["checks"], Tone>;

export const mergeStates = {
  clean: ["ready", "good"],
  blocked: ["blocked", "wait"],
  behind: ["behind main", "wait"],
  conflicts: ["conflicts", "bad"],
  unstable: ["checks not green", "wait"],
  checking: ["checking", "idle"],
  unknown: ["unknown", "idle"],
} as const satisfies Record<PrState["mergeState"], readonly [string, Tone]>;

const closedStates = {
  merged: ["merged", "info"],
  closed: ["closed", "idle"],
  draft: ["draft", "idle"],
} as const satisfies Record<string, readonly [string, Tone]>;

/** Open findings above this count share one face. */
export const mostOpenFindings = 20;

export function findingsFace({
  resolved,
  open,
}: PrState["coderabbit"]["findings"]): [string, Tone] {
  if (resolved + open === 0) return ["none", "idle"];
  if (open === 0) return ["all resolved", "good"];
  return [
    open > mostOpenFindings ? `${mostOpenFindings}+ open` : `${open} open`,
    "wait",
  ];
}

export function mergeFace(pr: PrState): [string, Tone] {
  if (pr.state === "merged") return [...closedStates.merged];
  if (pr.state === "closed") return [...closedStates.closed];
  if (pr.isDraft) return [...closedStates.draft];
  const [message, tone] = mergeStates[pr.mergeState];
  return [message, tone];
}

/** Every face any pull request can show, each once. */
export function allFaces(): Face[] {
  const pairs = (
    label: Label,
    entries: Iterable<readonly [string, Tone]>,
  ): Face[] =>
    [...entries].map(([message, tone]) => ({ label, message, tone }));
  const openCounts = Array.from(
    { length: mostOpenFindings + 1 },
    (_, i) => i + 1,
  );
  const faces = [
    ...pairs("preview", Object.values(preview)),
    ...pairs("coderabbit", Object.entries(review) as [string, Tone][]),
    ...pairs("findings", [
      findingsFace({ resolved: 0, open: 0 }),
      findingsFace({ resolved: 1, open: 0 }),
      ...openCounts.map((open) => findingsFace({ resolved: 0, open })),
    ]),
    ...pairs("checks", Object.entries(checks) as [string, Tone][]),
    ...pairs("merge", [
      ...Object.values(mergeStates),
      ...Object.values(closedStates),
    ]),
  ];
  const seen = new Set<string>();
  return faces.filter((face) => {
    const name = faceFile(face);
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

/** The file a face is drawn to: `merge-checks-not-green.svg`. */
export function faceFile({ label, message }: Pick<Face, "label" | "message">) {
  const slug = message
    .toLowerCase()
    .replace(/\+/g, "-plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${label}-${slug}.svg`;
}

/** The file the Explain Change shield, which opens the Change Stack, is drawn to. */
export const explainChangeFile = "coderabbit-explain-change.svg";
