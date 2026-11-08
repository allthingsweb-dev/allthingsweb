import { statements } from "./statements.ts";

/**
 * An idea may be `postponed`: put off with no date, keeping its draft
 * evening and everything on it (its lineup, talks, collaboration and
 * notes), until it is given a date again and goes back to `drafting`.
 * Readiness says so instead of asking for a date (src/readiness/checks.ts).
 *
 * Ships with the app's drizzle migration 0048_idea_postponed, which makes
 * the same change.
 */
export const ideaPostponed: ReadonlyArray<string> = [
  `ALTER TABLE "planning"."ideas" DROP CONSTRAINT "ideas_status_check"`,
  `ALTER TABLE "planning"."ideas" ADD CONSTRAINT "ideas_status_check" CHECK ("status" IN ('idea', 'drafting', 'scheduled', 'postponed', 'dropped'))`,
];

export default statements(ideaPostponed);
