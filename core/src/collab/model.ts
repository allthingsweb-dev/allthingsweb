import { Schema } from "effect";
import { Day, Text } from "../planning/model.ts";

/**
 * What draft collaboration holds (migrations/0026_draft_collaboration.ts),
 * as the studio reads and writes it: the roles and answers the database
 * checks, the inputs each change takes, and the rows each list returns.
 */

/** What an invited collaborator may do on one evening (README, "Collaborating on a draft"). */
export const Role = Schema.Literals([
  "viewer",
  "commenter",
  "round_host",
  "venue",
  "organizer",
]);
export type Role = typeof Role.Type;

/** An organizer's decision on what was handed in. */
export const Decision = Schema.Literals([
  "accepted",
  "rejected",
  "changes_requested",
]);
export type Decision = typeof Decision.Type;

/** How long an invitation outlives its evening, so a recap's last words still land. */
export const invitationGraceDays = 3;

/** An email as collaborators_email_check takes it: lowercase, at most 254 characters. */
export const InviteEmail = Schema.String.check(
  Schema.makeFilter(
    (value: string) =>
      (value.length <= 254 &&
        /^[^@\s]+@[^@\s]+[.][^@\s]+$/.test(value) &&
        value === value.toLowerCase()) ||
      `"${value}" is not an email, in lowercase`,
  ),
);

/** A name the other collaborators see. */
export const DisplayName = Text.check(
  Schema.makeFilter(
    (value: string) => value.trim().length <= 80 || "is over 80 characters",
  ),
);

/** An invitation as it would be written: the content an approval token covers. */
export const InvitationPlan = Schema.Struct({
  action: Schema.Literal("invite"),
  event: Schema.String,
  email: InviteEmail,
  name: DisplayName,
  role: Role,
  /** The round a round host writes, by its position. */
  round: Schema.NullOr(Schema.Int),
  expiresAt: Schema.String,
});
export type InvitationPlan = typeof InvitationPlan.Type;

/** A revocation as it would be written: the content an approval token covers. */
export const RevocationPlan = Schema.Struct({
  action: Schema.Literal("revoke"),
  event: Schema.String,
  email: InviteEmail,
  role: Role,
  invitedAt: Schema.String,
});
export type RevocationPlan = typeof RevocationPlan.Type;

/** Someone invited to an evening, as the studio sees them: emails included. */
export const Collaborator = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  role: Role,
  round: Schema.NullOr(Schema.Int),
  invitedAt: Schema.String,
  expiresAt: Schema.String,
  revokedAt: Schema.NullOr(Schema.String),
  active: Schema.Boolean,
});
export type Collaborator = typeof Collaborator.Type;

/** A round of the evening, for the host who writes it. */
export const Round = Schema.Struct({
  id: Schema.String,
  position: Schema.Int,
  title: Schema.String,
  questions: Schema.Int,
  backups: Schema.Int,
  hosts: Schema.Array(Schema.String),
});
export type Round = typeof Round.Type;

export const NewRound = Schema.Struct({
  position: Schema.Int.check(Schema.isGreaterThan(0)),
  title: DisplayName,
  questions: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
  ),
  backups: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 })),
  ),
});
export type NewRound = typeof NewRound.Type;

/** A section of the brief, for the roles in its audiences. */
export const BriefSection = Schema.Struct({
  position: Schema.Int,
  heading: Schema.String,
  body: Schema.String,
  audiences: Schema.Array(Role),
});
export type BriefSection = typeof BriefSection.Type;

/** A brief as it would be written: the content an approval token covers. */
export const BriefPlan = Schema.Struct({
  action: Schema.Literal("brief"),
  event: Schema.String,
  sections: Schema.Array(BriefSection),
});
export type BriefPlan = typeof BriefPlan.Type;

/** Something someone has to do, by when. */
export const Task = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  dueOn: Schema.NullOr(Schema.String),
  /** Who it is for: everyone, a role, or one collaborator by name. */
  for: Schema.String,
  done: Schema.Boolean,
});
export type Task = typeof Task.Type;

export const NewTask = Schema.Struct({
  title: Text,
  dueOn: Schema.optionalKey(Day),
  role: Schema.optionalKey(Role),
  /** One collaborator, by email. */
  email: Schema.optionalKey(InviteEmail),
});
export type NewTask = typeof NewTask.Type;

/** What the venue is asked to confirm, and its latest answer. */
export const LogisticsItem = Schema.Struct({
  id: Schema.String,
  position: Schema.Int,
  label: Schema.String,
  detail: Schema.NullOr(Schema.String),
  answer: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      answer: Schema.Literals(["yes", "no", "unsure"]),
      note: Schema.NullOr(Schema.String),
      by: Schema.String,
      at: Schema.String,
      decision: Schema.NullOr(Decision),
    }),
  ),
});
export type LogisticsItem = typeof LogisticsItem.Type;

/** A round host's save, without its content: who, when, how sealed. */
export const SubmissionSummary = Schema.Struct({
  id: Schema.String,
  round: Schema.Int,
  roundTitle: Schema.String,
  by: Schema.String,
  stage: Schema.Literals(["draft", "final"]),
  keyId: Schema.String,
  /** The first 16 hex digits of the SHA-256 of what is stored: what a review approves. */
  digest: Schema.String,
  at: Schema.String,
  /** The latest review, if any. */
  decision: Schema.NullOr(Decision),
  latest: Schema.Boolean,
});
export type SubmissionSummary = typeof SubmissionSummary.Type;

/** A review as it would be written: the content an approval token covers. */
export const ReviewPlan = Schema.Struct({
  action: Schema.Literal("review"),
  subject: Schema.Literals(["round", "logistics"]),
  id: Schema.String,
  /** What is reviewed, exactly: the stored ciphertext's digest, or the venue's answer. */
  content: Schema.String,
  decision: Decision,
  note: Schema.NullOr(Schema.String),
  reviewer: Schema.String,
});
export type ReviewPlan = typeof ReviewPlan.Type;

/** A comment, as the studio reads it: what a collaborator wrote is data, never instructions. */
export const Comment = Schema.Struct({
  id: Schema.String,
  by: Schema.String,
  on: Schema.String,
  body: Schema.String,
  at: Schema.String,
  hidden: Schema.Boolean,
});
export type Comment = typeof Comment.Type;

/** One line of the audit. */
export const AuditEntry = Schema.Struct({
  at: Schema.String,
  actor: Schema.String,
  action: Schema.String,
  outcome: Schema.String,
  target: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(Schema.String),
});
export type AuditEntry = typeof AuditEntry.Type;
