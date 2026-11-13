/**
 * proposal_intake, the role the site's Worker sends proposals as
 * (src/proposal-intake.ts): its name, the `planning.proposals` columns it
 * may INSERT, and the bounds on its sessions. migrations/0040_proposals.ts
 * made the role and granted these, and infra/scripts/proposal-intake.ts
 * refuses to give it a login unless the catalog holds exactly these. It
 * imports nothing, so the infra scripts read it without core's
 * dependencies.
 *
 * The migration states its own copy, fixed as it ran: a change to the role
 * is a new migration that grants (or revokes) the difference, with these
 * lists changed in the same pull request, so the script and
 * tests/proposal-intake-role.test.ts agree with it.
 */

export const PROPOSAL_INTAKE = "proposal_intake";

/** The columns of `planning.proposals` it may INSERT: no status, no decision, no organizer. */
export const PROPOSAL_INTAKE_INSERTS = [
  "title",
  "abstract",
  "format",
  "name",
  "email",
  "about",
  "links",
  "notes",
  "source",
] as const;

/** Bounds on every session: one short INSERT a request. */
export const PROPOSAL_INTAKE_SETTINGS = {
  statement_timeout: "5s",
  lock_timeout: "2s",
  idle_in_transaction_session_timeout: "5s",
} as const;
