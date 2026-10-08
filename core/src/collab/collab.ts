import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import { approvalToken, isApprovalToken } from "../approval.ts";
import { DataSourceError } from "../errors.ts";
import { PlanningError } from "../planning/planning.ts";
import { maxSections } from "./brief.ts";
import {
  AuditEntry,
  type BriefPlan,
  type BriefSection,
  Collaborator,
  Comment,
  type Decision,
  type InvitationPlan,
  invitationGraceDays,
  LogisticsItem,
  type NewRound,
  type NewTask,
  type ReviewPlan,
  type RevocationPlan,
  type Role,
  Round,
  SubmissionSummary,
  Task,
} from "./model.ts";

/**
 * The studio's side of collaborating on a draft (README, "Collaborating on
 * a draft"; migrations/0026_draft_collaboration.ts): who is invited to an
 * evening, its rounds, brief, tasks and logistics, and the organizers'
 * reviews of what collaborators hand in. `bun run collab` (scripts/collab.ts)
 * and the admin MCP server's collab tools run through here.
 *
 * It runs as the database owner, which row security doesn't hold back: the
 * Worker, as draft_collab, is the one the policies are for.
 *
 * What changes who may see what (an invitation, a revocation, the brief, a
 * review) is approved before it is written: without a token, each returns
 * what it would write and that content's approval token (src/approval.ts);
 * with one, it works the content out again and writes only if it hashes
 * the same. Everything else writes at once, and the CLI's --dry-run rolls
 * it back.
 *
 * What collaborators wrote (comments, the venue's notes) is returned as
 * data. Nothing here reads a round's questions: they are sealed by the
 * Worker, and only `collab export` opens them.
 */

type Failure = PlanningError | DataSourceError;

const refuse = (reason: string) => Effect.fail(new PlanningError({ reason }));

/** What an approved change returns: the content, its token, and whether it was written. */
export interface Approval<P> {
  readonly plan: P;
  readonly token: string;
  readonly written: boolean;
}

export interface InviteInput {
  readonly event: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  readonly round?: number;
}

export interface ReviewInput {
  readonly subject: "round" | "logistics";
  readonly id: string;
  readonly decision: Decision;
  readonly note?: string;
  readonly reviewer: string;
}

export interface NewLogisticsItem {
  readonly position: number;
  readonly label: string;
  readonly detail?: string;
}

export interface CollabShape {
  readonly invite: (
    input: InviteInput,
    approve?: string,
  ) => Effect.Effect<Approval<InvitationPlan>, Failure>;
  readonly revoke: (
    input: { readonly event: string; readonly email: string },
    approve?: string,
  ) => Effect.Effect<Approval<RevocationPlan>, Failure>;
  readonly collaborators: (
    event: string,
  ) => Effect.Effect<ReadonlyArray<Collaborator>, Failure>;
  /** Every active invitation's email, on any evening: what Access's list holds. */
  readonly activeEmails: Effect.Effect<ReadonlyArray<string>, Failure>;
  readonly addRound: (
    event: string,
    round: NewRound,
  ) => Effect.Effect<Round, Failure>;
  readonly rounds: (
    event: string,
  ) => Effect.Effect<ReadonlyArray<Round>, Failure>;
  readonly setBrief: (
    event: string,
    sections: ReadonlyArray<BriefSection>,
    approve?: string,
  ) => Effect.Effect<Approval<BriefPlan>, Failure>;
  readonly brief: (
    event: string,
  ) => Effect.Effect<ReadonlyArray<BriefSection>, Failure>;
  readonly addTask: (
    event: string,
    task: NewTask,
  ) => Effect.Effect<Task, Failure>;
  readonly finishTask: (id: string) => Effect.Effect<Task, Failure>;
  readonly tasks: (
    event: string,
  ) => Effect.Effect<ReadonlyArray<Task>, Failure>;
  readonly addLogisticsItem: (
    event: string,
    item: NewLogisticsItem,
  ) => Effect.Effect<LogisticsItem, Failure>;
  readonly logistics: (
    event: string,
  ) => Effect.Effect<ReadonlyArray<LogisticsItem>, Failure>;
  readonly submissions: (
    event: string,
  ) => Effect.Effect<ReadonlyArray<SubmissionSummary>, Failure>;
  readonly review: (
    input: ReviewInput,
    approve?: string,
  ) => Effect.Effect<Approval<ReviewPlan>, Failure>;
  readonly comments: (
    event: string,
  ) => Effect.Effect<ReadonlyArray<Comment>, Failure>;
  readonly hideComment: (id: string) => Effect.Effect<Comment, Failure>;
  readonly audit: (
    event: string,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<AuditEntry>, Failure>;
}

/** `column`, a timestamptz, as an ISO instant in UTC, whatever the session's time zone. */
const iso = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const isId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

const normalEmail = (email: string) => email.trim().toLowerCase();

const EventRow = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  endDate: Schema.String,
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  /** Folds SQL and decoding failures into DataSourceError, keeping PlanningError. */
  const run = <A>(
    effect: Effect.Effect<A, PlanningError | SqlError | Schema.SchemaError>,
  ): Effect.Effect<A, Failure> =>
    effect.pipe(
      Effect.catchTag(["SqlError", "SchemaError"], (cause) =>
        Effect.fail(new DataSourceError({ cause })),
      ),
    );
  const inTransaction = <A>(
    effect: Effect.Effect<A, PlanningError | SqlError | Schema.SchemaError>,
  ) => run(sql.withTransaction(effect));

  const rows =
    <S extends Schema.Top>(schema: S) =>
    (raw: unknown) =>
      Schema.decodeUnknownEffect(Schema.Array(schema))(raw);

  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const event = (slug: string) =>
    sql`SELECT id, slug, ${sql.unsafe(iso("end_date"))} AS "endDate" FROM events WHERE slug = ${slug}`.pipe(
      Effect.flatMap(rows(EventRow)),
      Effect.flatMap(([row]) =>
        row === undefined
          ? refuse(`No event, published or draft, has the slug "${slug}".`)
          : Effect.succeed(row),
      ),
    );

  /** When an invitation to an evening ending at `endDate` runs out. */
  const expiryFor = (endDate: string) =>
    DateTime.formatIso(
      DateTime.add(DateTime.makeUnsafe(endDate), { days: invitationGraceDays }),
    );

  /** The approval of `plan`: its token, and whether `approve` matches it. */
  const approval = <P>(plan: P, approve: string | undefined) =>
    Effect.gen(function* () {
      const token = yield* approvalToken(plan);
      if (approve === undefined) return { plan, token, approved: false };
      if (!isApprovalToken(approve)) {
        return yield* refuse(
          `"${approve}" is not an approval token: 16 hex digits, as the dry run prints.`,
        );
      }
      if (approve !== token) {
        return yield* refuse(
          `What would be written has changed since ${approve} was approved: it is now ${token}. Read it again without --approve, and approve that.`,
        );
      }
      return { plan, token, approved: true };
    });

  const roundAt = (eventId: string, position: number) =>
    sql`SELECT id FROM planning.rounds WHERE event_id = ${eventId} AND position = ${position}`.pipe(
      Effect.flatMap(rows(Schema.Struct({ id: Schema.String }))),
      Effect.flatMap(([row]) =>
        row === undefined
          ? refuse(
              `The evening has no round ${position}. Add it first: collab round add.`,
            )
          : Effect.succeed(row.id),
      ),
    );

  const ActiveRow = Schema.Struct({
    role: Schema.String,
    invitedAt: Schema.String,
  });
  const active = (eventId: string, email: string) =>
    sql`SELECT role, ${sql.unsafe(iso("invited_at"))} AS "invitedAt"
        FROM planning.collaborators
        WHERE event_id = ${eventId} AND email = ${email} AND revoked_at IS NULL`.pipe(
      Effect.flatMap(rows(ActiveRow)),
    );

  const invite: CollabShape["invite"] = (input, approve) =>
    inTransaction(
      Effect.gen(function* () {
        const evening = yield* event(input.event);
        const email = normalEmail(input.email);
        const name = input.name.trim();
        if (!/^[^@\s]+@[^@\s]+[.][^@\s]+$/.test(email) || email.length > 254) {
          return yield* refuse(`"${input.email}" is not an email.`);
        }
        if (name === "" || name.length > 80) {
          return yield* refuse("A name the others see: 1 to 80 characters.");
        }
        if ((input.role === "round_host") !== (input.round !== undefined)) {
          return yield* refuse(
            input.role === "round_host"
              ? "A round host writes one round: give --round <its position>."
              : "Only a round host has a round.",
          );
        }
        const expiresAt = expiryFor(evening.endDate);
        if (expiresAt <= (yield* now)) {
          return yield* refuse(
            `${evening.slug} ended more than ${invitationGraceDays} days ago: there is nothing to collaborate on.`,
          );
        }
        const roundId =
          input.round === undefined
            ? null
            : yield* roundAt(evening.id, input.round);
        const [existing] = yield* active(evening.id, email);
        if (existing !== undefined) {
          return yield* refuse(
            `${email} is already invited to ${evening.slug} (${existing.role}, since ${existing.invitedAt}). Revoke that first to change it.`,
          );
        }
        const plan: InvitationPlan = {
          action: "invite",
          event: evening.slug,
          email,
          name,
          role: input.role,
          round: input.round ?? null,
          expiresAt,
        };
        const { token, approved } = yield* approval(plan, approve);
        if (approved) {
          yield* sql`
            INSERT INTO planning.collaborators (event_id, email, name, role, round_id, invited_at, expires_at)
            VALUES (${evening.id}, ${email}, ${name}, ${input.role}, ${roundId}, ${yield* now}, ${expiresAt})`;
        }
        return { plan, token, written: approved };
      }),
    );

  const revoke: CollabShape["revoke"] = (input, approve) =>
    inTransaction(
      Effect.gen(function* () {
        const evening = yield* event(input.event);
        const email = normalEmail(input.email);
        const [existing] = yield* active(evening.id, email);
        if (existing === undefined) {
          return yield* refuse(
            `${email} has no invitation to ${evening.slug} to revoke.`,
          );
        }
        const plan: RevocationPlan = {
          action: "revoke",
          event: evening.slug,
          email,
          role: Schema.decodeUnknownSync(Collaborator.fields.role)(
            existing.role,
          ),
          invitedAt: existing.invitedAt,
        };
        const { token, approved } = yield* approval(plan, approve);
        if (approved) {
          yield* sql`
            UPDATE planning.collaborators SET revoked_at = greatest(${yield* now}::timestamptz, invited_at)
            WHERE event_id = ${evening.id} AND email = ${email} AND revoked_at IS NULL`;
        }
        return { plan, token, written: approved };
      }),
    );

  const collaborators: CollabShape["collaborators"] = (slug) =>
    run(
      Effect.gen(function* () {
        const evening = yield* event(slug);
        return yield* sql`
          SELECT c.id, c.email, c.name, c.role, r.position AS round,
            ${sql.unsafe(iso("c.invited_at"))} AS "invitedAt",
            ${sql.unsafe(iso("c.expires_at"))} AS "expiresAt",
            ${sql.unsafe(`CASE WHEN c.revoked_at IS NULL THEN NULL ELSE ${iso("c.revoked_at")} END`)} AS "revokedAt",
            (c.revoked_at IS NULL AND c.expires_at > ${yield* now}::timestamptz) AS active
          FROM planning.collaborators c
          LEFT JOIN planning.rounds r ON r.id = c.round_id
          WHERE c.event_id = ${evening.id}
          ORDER BY c.revoked_at IS NOT NULL, c.role, c.name, c.email, c.invited_at`.pipe(
          Effect.flatMap(rows(Collaborator)),
        );
      }),
    );

  const activeEmails: CollabShape["activeEmails"] = run(
    Effect.gen(function* () {
      const found = yield* sql`
        SELECT DISTINCT email FROM planning.collaborators
        WHERE revoked_at IS NULL AND expires_at > ${yield* now}::timestamptz
        ORDER BY email`.pipe(
        Effect.flatMap(rows(Schema.Struct({ email: Schema.String }))),
      );
      return found.map((row) => row.email);
    }),
  );

  const roundsOf = (eventId: string) =>
    sql`
      SELECT r.id, r.position, r.title, r.questions, r.backups,
        COALESCE((SELECT array_agg(c.name ORDER BY c.name) FROM planning.collaborators c
          WHERE c.round_id = r.id AND c.revoked_at IS NULL), '{}') AS hosts
      FROM planning.rounds r WHERE r.event_id = ${eventId} ORDER BY r.position`.pipe(
      Effect.flatMap(rows(Round)),
    );

  const addRound: CollabShape["addRound"] = (slug, round) =>
    inTransaction(
      Effect.gen(function* () {
        const evening = yield* event(slug);
        const taken =
          yield* sql`SELECT 1 FROM planning.rounds WHERE event_id = ${evening.id} AND position = ${round.position}`;
        if (taken.length > 0) {
          return yield* refuse(
            `${evening.slug} already has a round ${round.position}.`,
          );
        }
        yield* sql`
          INSERT INTO planning.rounds (event_id, position, title, questions, backups)
          VALUES (${evening.id}, ${round.position}, ${round.title.trim()}, ${round.questions ?? 8}, ${round.backups ?? 1})`;
        const added = (yield* roundsOf(evening.id)).find(
          (r) => r.position === round.position,
        );
        if (added === undefined)
          return yield* Effect.die("the round just added is missing");
        return added;
      }),
    );

  const rounds: CollabShape["rounds"] = (slug) =>
    run(event(slug).pipe(Effect.flatMap((evening) => roundsOf(evening.id))));

  const briefOf = (eventId: string) =>
    sql`SELECT position, heading, body, audiences FROM planning.brief_sections
        WHERE event_id = ${eventId} ORDER BY position`.pipe(
      Effect.flatMap(
        rows(
          Schema.Struct({
            position: Schema.Int,
            heading: Schema.String,
            body: Schema.String,
            audiences: Schema.Array(Collaborator.fields.role),
          }),
        ),
      ),
    );

  const setBrief: CollabShape["setBrief"] = (slug, sections, approve) =>
    inTransaction(
      Effect.gen(function* () {
        const evening = yield* event(slug);
        if (sections.length === 0 || sections.length > maxSections) {
          return yield* refuse(`A brief has 1 to ${maxSections} sections.`);
        }
        const plan: BriefPlan = {
          action: "brief",
          event: evening.slug,
          sections: [...sections],
        };
        const { token, approved } = yield* approval(plan, approve);
        if (approved) {
          const commented = yield* sql`
            SELECT b.heading FROM planning.comments c
            JOIN planning.brief_sections b ON b.id = c.section_id
            WHERE b.event_id = ${evening.id}`.pipe(
            Effect.flatMap(rows(Schema.Struct({ heading: Schema.String }))),
          );
          // A section someone commented on keeps its row (and so its
          // comments) when its heading stays; the rest are replaced.
          const kept = new Set(
            commented.map((row) => row.heading.toLowerCase()),
          );
          const missing = [...kept].filter(
            (heading) =>
              !sections.some((s) => s.heading.toLowerCase() === heading),
          );
          if (missing.length > 0) {
            return yield* refuse(
              `Collaborators commented on ${missing.map((h) => `"${h}"`).join(", ")}: keep those headings, or hide the comments first.`,
            );
          }
          // Positions move: park every row out of the way first.
          yield* sql`UPDATE planning.brief_sections SET position = position + 1000 WHERE event_id = ${evening.id}`;
          for (const section of sections) {
            const updated = yield* sql`
              UPDATE planning.brief_sections
              SET position = ${section.position}, body = ${section.body}, audiences = ${section.audiences}, updated_at = ${yield* now}
              WHERE event_id = ${evening.id} AND lower(heading) = ${section.heading.toLowerCase()}
              RETURNING id`;
            if (updated.length === 0) {
              yield* sql`
                INSERT INTO planning.brief_sections (event_id, position, heading, body, audiences, updated_at)
                VALUES (${evening.id}, ${section.position}, ${section.heading}, ${section.body}, ${section.audiences}, ${yield* now})`;
            }
          }
          yield* sql`DELETE FROM planning.brief_sections WHERE event_id = ${evening.id} AND position > 1000`;
        }
        return { plan, token, written: approved };
      }),
    );

  const brief: CollabShape["brief"] = (slug) =>
    run(event(slug).pipe(Effect.flatMap((evening) => briefOf(evening.id))));

  const taskJson = `
    SELECT t.id, t.title, t.due_on::text AS "dueOn",
      CASE WHEN t.collaborator_id IS NOT NULL THEN (SELECT c.name FROM planning.collaborators c WHERE c.id = t.collaborator_id)
           WHEN t.role IS NOT NULL THEN t.role ELSE 'everyone' END AS "for",
      t.done_at IS NOT NULL AS done
    FROM planning.tasks t`;

  const addTask: CollabShape["addTask"] = (slug, task) =>
    inTransaction(
      Effect.gen(function* () {
        const evening = yield* event(slug);
        if (task.role !== undefined && task.email !== undefined) {
          return yield* refuse(
            "A task is for a role or for one person, not both.",
          );
        }
        let collaboratorId: string | null = null;
        if (task.email !== undefined) {
          const email = normalEmail(task.email);
          const [found] = yield* sql`
            SELECT id FROM planning.collaborators
            WHERE event_id = ${evening.id} AND email = ${email} AND revoked_at IS NULL`.pipe(
            Effect.flatMap(rows(Schema.Struct({ id: Schema.String }))),
          );
          if (found === undefined) {
            return yield* refuse(`${email} isn't invited to ${evening.slug}.`);
          }
          collaboratorId = found.id;
        }
        const [added] = yield* sql`
          INSERT INTO planning.tasks (event_id, title, due_on, role, collaborator_id, created_at)
          VALUES (${evening.id}, ${task.title.trim()}, ${task.dueOn ?? null}, ${task.role ?? null}, ${collaboratorId}, ${yield* now})
          RETURNING id`.pipe(
          Effect.flatMap(rows(Schema.Struct({ id: Schema.String }))),
        );
        if (added === undefined)
          return yield* Effect.die("INSERT returned no id");
        const [row] =
          yield* sql`${sql.unsafe(taskJson)} WHERE t.id = ${added.id}`.pipe(
            Effect.flatMap(rows(Task)),
          );
        if (row === undefined)
          return yield* Effect.die("the task just added is missing");
        return row;
      }),
    );

  const finishTask: CollabShape["finishTask"] = (id) =>
    inTransaction(
      Effect.gen(function* () {
        if (!isId(id)) return yield* refuse(`"${id}" is not a task's id.`);
        const updated = yield* sql`
          UPDATE planning.tasks SET done_at = coalesce(done_at, ${yield* now}) WHERE id = ${id} RETURNING id`;
        if (updated.length === 0)
          return yield* refuse(`No task has the id ${id}.`);
        const [row] =
          yield* sql`${sql.unsafe(taskJson)} WHERE t.id = ${id}`.pipe(
            Effect.flatMap(rows(Task)),
          );
        if (row === undefined) return yield* Effect.die("the task is missing");
        return row;
      }),
    );

  const tasks: CollabShape["tasks"] = (slug) =>
    run(
      event(slug).pipe(
        Effect.flatMap(
          (evening) =>
            sql`${sql.unsafe(taskJson)} WHERE t.event_id = ${evening.id}
                ORDER BY t.due_on NULLS LAST, t.created_at, t.id`,
        ),
        Effect.flatMap(rows(Task)),
      ),
    );

  const logisticsOf = (eventId: string) =>
    sql`
      SELECT i.id, i.position, i.label, i.detail,
        (SELECT json_build_object('id', l.id, 'answer', l.answer, 'note', l.note,
            'by', c.name, 'at', ${sql.unsafe(iso("l.created_at"))},
            'decision', (SELECT v.decision FROM planning.reviews v WHERE v.logistics_confirmation_id = l.id ORDER BY v.created_at DESC, v.id LIMIT 1))
          FROM planning.logistics_confirmations l JOIN planning.collaborators c ON c.id = l.collaborator_id
          WHERE l.item_id = i.id ORDER BY l.created_at DESC, l.id LIMIT 1) AS answer
      FROM planning.logistics_items i WHERE i.event_id = ${eventId} ORDER BY i.position`.pipe(
      Effect.flatMap(rows(LogisticsItem)),
    );

  const addLogisticsItem: CollabShape["addLogisticsItem"] = (slug, item) =>
    inTransaction(
      Effect.gen(function* () {
        const evening = yield* event(slug);
        const label = item.label.trim();
        const detail = item.detail?.trim();
        if (!Number.isInteger(item.position) || item.position < 1) {
          return yield* refuse("A position is a whole number from 1.");
        }
        if (label === "" || label.length > 120) {
          return yield* refuse("A label is 1 to 120 characters.");
        }
        if (detail !== undefined && (detail === "" || detail.length > 1000)) {
          return yield* refuse("A detail is 1 to 1000 characters.");
        }
        const taken =
          yield* sql`SELECT 1 FROM planning.logistics_items WHERE event_id = ${evening.id} AND position = ${item.position}`;
        if (taken.length > 0) {
          return yield* refuse(
            `${evening.slug} already has a logistics item ${item.position}.`,
          );
        }
        yield* sql`
          INSERT INTO planning.logistics_items (event_id, position, label, detail, created_at)
          VALUES (${evening.id}, ${item.position}, ${label}, ${detail ?? null}, ${yield* now})`;
        const added = (yield* logisticsOf(evening.id)).find(
          (i) => i.position === item.position,
        );
        if (added === undefined)
          return yield* Effect.die("the item just added is missing");
        return added;
      }),
    );

  const logistics: CollabShape["logistics"] = (slug) =>
    run(event(slug).pipe(Effect.flatMap((evening) => logisticsOf(evening.id))));

  const digest = `substr(encode(sha256(s.ciphertext), 'hex'), 1, 16)`;

  const submissions: CollabShape["submissions"] = (slug) =>
    run(
      Effect.gen(function* () {
        const evening = yield* event(slug);
        return yield* sql`
          SELECT s.id, r.position AS round, r.title AS "roundTitle", c.name AS by, s.stage,
            s.key_id AS "keyId", ${sql.unsafe(digest)} AS digest,
            ${sql.unsafe(iso("s.created_at"))} AS at,
            (SELECT v.decision FROM planning.reviews v WHERE v.round_submission_id = s.id
              ORDER BY v.created_at DESC, v.id LIMIT 1) AS decision,
            NOT EXISTS (SELECT 1 FROM planning.round_submissions n
              WHERE n.round_id = s.round_id AND (n.created_at, n.id) > (s.created_at, s.id)) AS latest
          FROM planning.round_submissions s
          JOIN planning.rounds r ON r.id = s.round_id
          JOIN planning.collaborators c ON c.id = s.collaborator_id
          WHERE s.event_id = ${evening.id}
          ORDER BY r.position, s.created_at, s.id`.pipe(
          Effect.flatMap(rows(SubmissionSummary)),
        );
      }),
    );

  const review: CollabShape["review"] = (input, approve) =>
    inTransaction(
      Effect.gen(function* () {
        if (!isId(input.id))
          return yield* refuse(`"${input.id}" is not an id.`);
        const note = input.note?.trim();
        if (note !== undefined && (note === "" || note.length > 2000)) {
          return yield* refuse("A note is 1 to 2000 characters.");
        }
        const reviewer = input.reviewer.trim();
        if (reviewer === "" || reviewer.length > 80) {
          return yield* refuse("A reviewer is named in 1 to 80 characters.");
        }
        const [found] = yield* (
          input.subject === "round"
            ? sql`SELECT ${sql.unsafe(digest)} AS content FROM planning.round_submissions s WHERE s.id = ${input.id}`
            : sql`SELECT l.answer || ': ' || coalesce(l.note, '') AS content FROM planning.logistics_confirmations l WHERE l.id = ${input.id}`
        ).pipe(Effect.flatMap(rows(Schema.Struct({ content: Schema.String }))));
        if (found === undefined) {
          return yield* refuse(
            `No ${input.subject === "round" ? "round submission" : "logistics answer"} has the id ${input.id}.`,
          );
        }
        const plan: ReviewPlan = {
          action: "review",
          subject: input.subject,
          id: input.id,
          content: found.content,
          decision: input.decision,
          note: note ?? null,
          reviewer,
        };
        const { token, approved } = yield* approval(plan, approve);
        if (approved) {
          yield* sql`
            INSERT INTO planning.reviews (round_submission_id, logistics_confirmation_id, decision, note, reviewer, created_at)
            VALUES (${input.subject === "round" ? input.id : null}, ${input.subject === "logistics" ? input.id : null},
              ${input.decision}, ${note ?? null}, ${reviewer}, ${yield* now})`;
        }
        return { plan, token, written: approved };
      }),
    );

  const commentJson = `
    SELECT m.id, m.author_name AS by,
      CASE WHEN m.section_id IS NOT NULL THEN 'section: ' || (SELECT b.heading FROM planning.brief_sections b WHERE b.id = m.section_id)
           WHEN m.round_id IS NOT NULL THEN 'round ' || (SELECT r.position FROM planning.rounds r WHERE r.id = m.round_id)
           ELSE 'the evening' END AS on,
      m.body, ${iso("m.created_at")} AS at, m.hidden_at IS NOT NULL AS hidden
    FROM planning.comments m`;

  const comments: CollabShape["comments"] = (slug) =>
    run(
      event(slug).pipe(
        Effect.flatMap(
          (evening) =>
            sql`${sql.unsafe(commentJson)} WHERE m.event_id = ${evening.id} ORDER BY m.created_at, m.id`,
        ),
        Effect.flatMap(rows(Comment)),
      ),
    );

  const hideComment: CollabShape["hideComment"] = (id) =>
    inTransaction(
      Effect.gen(function* () {
        if (!isId(id)) return yield* refuse(`"${id}" is not a comment's id.`);
        const updated = yield* sql`
          UPDATE planning.comments SET hidden_at = coalesce(hidden_at, greatest(${yield* now}::timestamptz, created_at))
          WHERE id = ${id} RETURNING id`;
        if (updated.length === 0)
          return yield* refuse(`No comment has the id ${id}.`);
        const [row] =
          yield* sql`${sql.unsafe(commentJson)} WHERE m.id = ${id}`.pipe(
            Effect.flatMap(rows(Comment)),
          );
        if (row === undefined)
          return yield* Effect.die("the comment is missing");
        return row;
      }),
    );

  const audit: CollabShape["audit"] = (slug, limit) =>
    run(
      Effect.gen(function* () {
        const evening = yield* event(slug);
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
          return yield* refuse("--limit is 1 to 1000.");
        }
        return yield* sql`
          SELECT ${sql.unsafe(iso("a.at"))} AS at, a.actor_email AS actor, a.action, a.outcome,
            a.target_id AS target, a.detail
          FROM planning.collab_audit a WHERE a.event_id = ${evening.id}
          ORDER BY a.at DESC, a.id LIMIT ${limit}`.pipe(
          Effect.flatMap(rows(AuditEntry)),
        );
      }),
    );

  return {
    invite,
    revoke,
    collaborators,
    activeEmails,
    addRound,
    rounds,
    setBrief,
    brief,
    addTask,
    finishTask,
    tasks,
    addLogisticsItem,
    logistics,
    submissions,
    review,
    comments,
    hideComment,
    audit,
  } satisfies CollabShape;
});

export class Collab extends Context.Service<Collab, CollabShape>()(
  "allthings/Collab",
) {
  static readonly layer = Layer.effect(Collab, make);
}
