import type { PeopleImport } from "./people-sync.ts";
import type { Review } from "./people.ts";

/**
 * The people import's result as text for an organizer: what it would write
 * (or wrote), then every host to review, by event.
 */

const reviewLine = (review: Review): string => {
  if (review._tag === "Matched") {
    return `  matched ${review.how === "name" ? "by name" : "as decided"}: ${review.name} (${review.lumaUserId}) is profile ${review.profileId}`;
  }
  if (review._tag === "Created") {
    return `  new profile: ${review.name} (${review.lumaUserId})`;
  }
  if (review._tag === "Company") {
    return `  hosting company: ${review.name} (${review.lumaUserId})`;
  }
  return `  not imported: ${review.name ?? "(no name)"} (${review.lumaUserId}): ${review.reason}`;
};

/** "1 event", "2 events"; "1 hosting company", "2 hosting companies". */
const count = (n: number, noun: string, plural = `${noun}s`): string =>
  `${n} ${n === 1 ? noun : plural}`;

export function formatImport(result: PeopleImport): string {
  if (result._tag === "Skipped") return `Skipped: ${result.reason}.`;
  const { plan, written } = result;
  const lines = [
    `Asked Luma about ${count(result.asked, "published event")}; ${result.unavailable.length} not shown to us${
      result.unavailable.length === 0
        ? ""
        : `: ${result.unavailable.join(", ")}`
    }.`,
    `${written === null ? "Would write" : "Planned"}: ${count(plan.people.length, "host")} and ${count(plan.hosts.length, "hosting company", "hosting companies")} across ${count(plan.replacedEventIds.length, "event")}, ${count(plan.links.length, "profile")} to link, ${plan.newProfiles.length} to create, guest counts for ${count(plan.guestCounts.length, "event")}.`,
  ];
  if (written !== null) {
    lines.push(
      `Wrote: ${count(written.written, "host row")} added or reordered, ${written.removed} removed, ${count(written.hosted, "hosting company", "hosting companies")} attached, ${count(written.linked, "profile")} linked, ${written.created} created, guest counts changed for ${count(written.counted, "event")}.`,
    );
  }
  const byEvent = Map.groupBy(plan.review, (review) => review.lumaEventId);
  if (byEvent.size === 0) {
    lines.push("Nothing to review.");
  } else {
    lines.push("To review:");
    for (const [lumaEventId, reviews] of byEvent) {
      lines.push(lumaEventId, ...reviews.map(reviewLine));
    }
  }
  if (plan.review.some((review) => review._tag === "Unmatched")) {
    lines.push(
      "Hosts not imported wait for a decision: run again with --create <Luma user id> to make them a profile, or --link <Luma user id>=<profile id> if they have one.",
    );
  }
  return lines.join("\n");
}
