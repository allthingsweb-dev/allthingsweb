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
  return `  not imported: ${review.name ?? "(no name)"} (${review.lumaUserId}): ${review.reason}`;
};

export function formatImport(result: PeopleImport): string {
  if (result._tag === "Skipped") return `Skipped: ${result.reason}.`;
  const { plan, written } = result;
  const lines = [
    `Asked Luma about ${result.asked} published events; ${result.unavailable.length} not shown to us${
      result.unavailable.length === 0
        ? ""
        : `: ${result.unavailable.join(", ")}`
    }.`,
    `${written === null ? "Would write" : "Planned"}: ${plan.people.length} hosts across ${plan.replacedEventIds.length} events, ${plan.links.length} profiles matched by name, ${plan.newProfiles.length} new profiles, guest counts for ${plan.guestCounts.length} events.`,
  ];
  if (written !== null) {
    lines.push(
      `Wrote: ${written.written} host rows added or reordered, ${written.removed} removed, ${written.linked} profiles linked, ${written.created} created, ${written.counted} events' guest counts changed.`,
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
