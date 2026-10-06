/**
 * An evening in one line: what a page's meta description, its structured
 * data and the feed say about it. The organizers write it on the site
 * (`events.tagline`); until they do, it is a placeholder, and the summary
 * of Luma's description (`events.luma_summary`, src/luma/descriptions.ts)
 * stands in for it.
 */

/** A new event's tagline until an organizer writes one (src/luma/sync.ts). */
export const defaultTagline = "See Luma for event details and registration.";

/**
 * Whether `tagline` is a placeholder, not anyone's words: blank, or
 * {@link defaultTagline}. (The app's first Luma sync wrote "<name> at All
 * Things Web" instead; migrations/0011_event_description.ts made those
 * four the sync's placeholder.)
 */
export function isPlaceholderTagline(tagline: string): boolean {
  const text = tagline.trim();
  return text === "" || text === defaultTagline;
}

/**
 * The evening in one line: the organizers' tagline, or, while that is a
 * placeholder, the summary of Luma's description; empty when there is
 * neither.
 */
export function eventTagline(event: {
  readonly tagline: string;
  readonly lumaSummary: string | null;
}): string {
  return isPlaceholderTagline(event.tagline)
    ? (event.lumaSummary?.trim() ?? "")
    : event.tagline.trim();
}
