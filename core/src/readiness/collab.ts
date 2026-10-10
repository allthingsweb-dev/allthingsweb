import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { type CollabTable, readsEveryRow } from "../planning/privacy.ts";
import type { Check } from "./checks.ts";

/**
 * What collaborating on a draft still needs (README, "Collaborating on a
 * draft"; migrations/0026_draft_collaboration.ts), as readiness reports
 * it: rounds without a host, not handed in or not accepted, what the venue
 * hasn't confirmed, and tasks past their date. Every one is advice: an
 * evening goes out on Luma well before its rounds are due, so none of it
 * stops publishing; an overdue one says so.
 *
 * The checks are a pure function of what planning holds and the day in
 * San Francisco; `collabFacts` reads it, only as a role that reads every
 * row of it (`collabReadable`): the owner.
 */

export const collabCheckKinds = {
  "round-host": "a round without a host",
  "round-handed-in": "a round not handed in",
  "round-accepted": "a round handed in, not accepted",
  logistics: "something the venue hasn't confirmed",
  "task-overdue": "a task past its date",
} as const;

export type CollabCheckKind = keyof typeof collabCheckKinds;

/** What planning holds for a draft's collaboration. */
export const CollabFacts = Schema.Struct({
  rounds: Schema.Array(
    Schema.Struct({
      position: Schema.Int,
      title: Schema.String,
      hosts: Schema.Int,
      /** When its latest save handed in was made, if any. */
      handedIn: Schema.NullOr(Schema.String),
      /** That save's latest review. */
      decision: Schema.NullOr(Schema.String),
      /** The earliest date still open of the tasks for every round host, or for this round's own. */
      due: Schema.NullOr(Schema.String),
    }),
  ),
  logistics: Schema.Array(
    Schema.Struct({
      position: Schema.Int,
      label: Schema.String,
      answer: Schema.NullOr(Schema.String),
      decision: Schema.NullOr(Schema.String),
    }),
  ),
  tasks: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      dueOn: Schema.NullOr(Schema.String),
      done: Schema.Boolean,
      for: Schema.String,
    }),
  ),
});
export type CollabFacts = typeof CollabFacts.Type;

const advice = (
  kind: CollabCheckKind,
  message: string,
  subject: string | null,
): Check => ({ kind, level: "advice", subject, message });

/** Every collaboration check on a draft, on `today` (YYYY-MM-DD in San Francisco), in a fixed order. */
export function collabChecks(
  facts: CollabFacts,
  today: string,
): ReadonlyArray<Check> {
  const checks: Array<Check> = [];
  for (const round of facts.rounds) {
    const name = `round ${round.position}, ${round.title}`;
    if (round.hosts === 0) {
      checks.push(
        advice(
          "round-host",
          `No one is invited to host ${name}: bun run collab invite … --role round_host --round ${round.position}.`,
          name,
        ),
      );
      continue;
    }
    if (round.handedIn === null) {
      const late = round.due !== null && round.due < today;
      checks.push(
        advice(
          "round-handed-in",
          late
            ? `${name} isn't handed in, and was due ${round.due}.`
            : `${name} isn't handed in yet${round.due === null ? "" : ` (due ${round.due})`}.`,
          name,
        ),
      );
      continue;
    }
    if (round.decision !== "accepted") {
      checks.push(
        advice(
          "round-accepted",
          round.decision === null
            ? `${name} is handed in and not reviewed: bun run collab submissions, then collab review round.`
            : `${name}: its latest save is ${round.decision === "rejected" ? "not taken" : "waiting on changes"}.`,
          name,
        ),
      );
    }
  }
  for (const item of facts.logistics) {
    const settled = item.answer === "yes" && item.decision === "accepted";
    if (settled) continue;
    checks.push(
      advice(
        "logistics",
        item.answer === null
          ? `The venue hasn't answered "${item.label}".`
          : item.answer !== "yes"
            ? `The venue answered "${item.label}": ${item.answer}.`
            : item.decision === null
              ? `The venue confirmed "${item.label}": not reviewed yet.`
              : `The venue confirmed "${item.label}", and it was ${item.decision === "rejected" ? "not taken" : "sent back for changes"}: ask them again.`,
        item.label,
      ),
    );
  }
  for (const task of facts.tasks) {
    if (task.done || task.dueOn === null || task.dueOn >= today) continue;
    checks.push(
      advice(
        "task-overdue",
        `"${task.title}" (for ${task.for}) was due ${task.dueOn}.`,
        task.title,
      ),
    );
  }
  return checks;
}

/**
 * The tables `collabFacts` reads. Each has row security
 * (migrations/0026_draft_collaboration.ts), whose policies show any role
 * but the owner only what a signed-in collaborator may see, and
 * `collaborators` nothing at all: read as such a role, the facts would come
 * back empty rather than fail, and the advice would say all is well.
 */
export const collabTables: ReadonlyArray<CollabTable> = [
  "rounds",
  "collaborators",
  "round_submissions",
  "reviews",
  "tasks",
  "logistics_items",
  "logistics_confirmations",
];

/**
 * Whether this role sees every row of `collabTables` (src/planning/
 * privacy.ts): the studio or the owner. As any other role readiness leaves
 * the collaboration's advice out, and says so.
 */
export const collabReadable = readsEveryRow(collabTables);

/** What planning holds for the draft `eventId`'s collaboration, read as the owner. */
export const collabFacts = (eventId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const rounds = yield* sql`
      SELECT r.position, r.title,
        (SELECT count(*)::int FROM planning.collaborators c
          WHERE c.round_id = r.id AND c.revoked_at IS NULL AND c.expires_at > now()) AS hosts,
        s.created_at::text AS "handedIn",
        (SELECT v.decision FROM planning.reviews v WHERE v.round_submission_id = s.id
          ORDER BY v.created_at DESC, v.id LIMIT 1) AS decision,
        (SELECT min(t.due_on)::text FROM planning.tasks t
          WHERE t.event_id = r.event_id AND t.done_at IS NULL
            AND (t.role = 'round_host'
              OR t.collaborator_id IN (SELECT c.id FROM planning.collaborators c WHERE c.round_id = r.id))) AS due
      FROM planning.rounds r
      LEFT JOIN LATERAL (
        SELECT n.id, n.created_at FROM planning.round_submissions n
        WHERE n.round_id = r.id AND n.stage = 'final'
        ORDER BY n.created_at DESC, n.id DESC LIMIT 1
      ) s ON true
      WHERE r.event_id = ${eventId}
      ORDER BY r.position`;
    const logistics = yield* sql`
      SELECT i.position, i.label, l.answer,
        (SELECT v.decision FROM planning.reviews v WHERE v.logistics_confirmation_id = l.id
          ORDER BY v.created_at DESC, v.id LIMIT 1) AS decision
      FROM planning.logistics_items i
      LEFT JOIN LATERAL (
        SELECT c.id, c.answer FROM planning.logistics_confirmations c
        WHERE c.item_id = i.id ORDER BY c.created_at DESC, c.id DESC LIMIT 1
      ) l ON true
      WHERE i.event_id = ${eventId}
      ORDER BY i.position`;
    const tasks = yield* sql`
      SELECT t.title, t.due_on::text AS "dueOn", t.done_at IS NOT NULL AS done,
        CASE WHEN t.collaborator_id IS NOT NULL
               THEN (SELECT c.name FROM planning.collaborators c WHERE c.id = t.collaborator_id)
             WHEN t.role IS NOT NULL THEN t.role ELSE 'everyone' END AS for
      FROM planning.tasks t WHERE t.event_id = ${eventId}
      ORDER BY t.due_on NULLS LAST, t.created_at, t.id`;
    return yield* Schema.decodeUnknownEffect(CollabFacts)({
      rounds,
      logistics,
      tasks,
    });
  });
