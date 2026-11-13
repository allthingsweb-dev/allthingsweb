import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import {
  linksParameter,
  type ProposalInput,
  type ProposalSource,
} from "./proposals.ts";

/**
 * Proposals from anyone (the site's form, its MCP server, the CLI, the
 * API), sent as `proposal_intake`: a role that may only INSERT a proposal
 * (migrations/0040_proposals.ts). It reads nothing back, so a request
 * learns only that its proposal was taken: no id, no row, nothing of
 * anyone else's.
 *
 * The role itself is src/proposal-intake-role.ts.
 */

/** The ways in from outside: every source but an organizer's. */
export type IntakeSource = Exclude<ProposalSource, "organizer">;

/**
 * The table took as many proposals from outside today as it takes in a
 * day (migrations/0040_proposals.ts): nothing was kept.
 */
export class ProposalIntakeFull extends Schema.TaggedError<ProposalIntakeFull>()(
  "ProposalIntakeFull",
  {},
) {
  override get message(): string {
    return "We've had more proposals than usual today, so this one wasn't kept. Please send it again tomorrow, or email hello@allthings.dev.";
  }
}

/** Whether `cause`, a driver's error, is the table's daily limit (SQLSTATE 54000). */
const isDailyLimit = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  (cause as { readonly code?: unknown }).code === "54000";

/**
 * Keeps `proposal`, read in by readProposal (src/proposals.ts), as sent
 * through `source`. It returns nothing: the role reads nothing back. The
 * same proposal sent again while the first is new is kept once, and the
 * caller can't tell; past the daily limit it fails with
 * {@link ProposalIntakeFull}.
 */
export const submitProposal = (proposal: ProposalInput, source: IntakeSource) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    yield* sql
      .unsafe(
        `INSERT INTO planning.proposals
           (title, abstract, format, name, email, about, links, notes, source)
         VALUES ($1, $2, $3, $4, $5, $6, string_to_array($7::text, chr(10)), $8, $9)`,
        [
          proposal.title,
          proposal.abstract,
          proposal.format,
          proposal.name,
          proposal.email,
          proposal.about,
          linksParameter(proposal.links),
          proposal.notes,
          source,
        ],
      )
      .pipe(
        Effect.catchTag("SqlError", (error) =>
          isDailyLimit(error.reason.cause)
            ? Effect.fail<ProposalIntakeFull | SqlError>(
                new ProposalIntakeFull(),
              )
            : Effect.fail<ProposalIntakeFull | SqlError>(error),
        ),
      );
  });
