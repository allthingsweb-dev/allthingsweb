import { PgClient } from "@effect/sql-pg";
import { DataSourceError } from "allthings-core/src/errors.ts";
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

/**
 * Collaborating on a draft, as the draft preview reads it (core/README.md,
 * "Collaborating on a draft"): which evenings the signer is invited to, and
 * the panel each shows them. Every read goes through the `COLLAB`
 * Hyperdrive as draft_collab (infra/scripts/draft-collab.ts), which never
 * caches, in a transaction that first says who is asking:
 *
 * - `collab.email`, the email Access signed in (access.ts), and
 *   `collab.organizer`, "on" for the stack's organizers, which the tables'
 *   row security reads (core/migrations/0026_draft_collaboration.ts);
 * - `SET LOCAL ROLE draft_collab`, which on the role's own connection
 *   changes nothing, and on any other (a test's superuser) holds the reads
 *   to the role's grants and policies all the same.
 *
 * So which rows come back is the database's to say, whatever these queries
 * ask: another evening's rows, another host's round, or a collaborator's
 * email are never among them.
 */

export const COLLAB_ROLE = "draft_collab";

/** Who is asking: what Access signed. */
export interface Signer {
  readonly email: string;
  readonly organizer: boolean;
}

/** An evening the signer may help with. */
export const Evening = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  isDraft: Schema.Boolean,
  roles: Schema.Array(Schema.String),
});
export type Evening = typeof Evening.Type;

export const Person = Schema.Struct({
  name: Schema.String,
  role: Schema.String,
  round: Schema.NullOr(Schema.Int),
  email: Schema.NullOr(Schema.String),
});
export type Person = typeof Person.Type;

export const PanelRound = Schema.Struct({
  id: Schema.String,
  position: Schema.Int,
  title: Schema.String,
  questions: Schema.Int,
  backups: Schema.Int,
});
export type PanelRound = typeof PanelRound.Type;

export const Section = Schema.Struct({
  id: Schema.String,
  heading: Schema.String,
  body: Schema.String,
  audiences: Schema.Array(Schema.String),
});
export type Section = typeof Section.Type;

export const PanelTask = Schema.Struct({
  title: Schema.String,
  dueOn: Schema.NullOr(Schema.String),
  done: Schema.Boolean,
});
export type PanelTask = typeof PanelTask.Type;

export const PanelComment = Schema.Struct({
  id: Schema.String,
  by: Schema.String,
  sectionId: Schema.NullOr(Schema.String),
  roundId: Schema.NullOr(Schema.String),
  body: Schema.String,
  at: Schema.String,
});
export type PanelComment = typeof PanelComment.Type;

/** What the venue confirms, and its latest answer, if any. */
export const PanelLogistics = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  detail: Schema.NullOr(Schema.String),
  latest: Schema.NullOr(
    Schema.Struct({
      answer: Schema.Literals(["yes", "no", "unsure"]),
      note: Schema.NullOr(Schema.String),
      by: Schema.NullOr(Schema.String),
      at: Schema.String,
      decision: Schema.NullOr(Schema.String),
    }),
  ),
});
export type PanelLogistics = typeof PanelLogistics.Type;

/** A venue's answer to an item, once its form is checked. */
export interface NewConfirmation {
  readonly itemId: string;
  readonly answer: "yes" | "no" | "unsure";
  readonly note: string | null;
}

/** What the panel under an evening's page shows the signer. */
export interface Panel {
  /** The signer's roles on the evening; "organizer" for the stack's. */
  readonly roles: ReadonlyArray<string>;
  /** The signer's own name, as the others see it; null for the stack's organizers. */
  readonly name: string | null;
  readonly people: ReadonlyArray<Person>;
  readonly rounds: ReadonlyArray<PanelRound>;
  /** The round the signer hosts, if any. */
  readonly hosts: ReadonlyArray<string>;
  readonly brief: ReadonlyArray<Section>;
  readonly tasks: ReadonlyArray<PanelTask>;
  readonly comments: ReadonlyArray<PanelComment>;
  /** What the venue confirms: only the venue and the organizers see any (the tables' row security). */
  readonly logistics: ReadonlyArray<PanelLogistics>;
}

export interface CollabShape {
  /** The evenings `signer` is invited to, soonest first by slug; none for a stranger. */
  readonly evenings: (
    signer: Signer,
  ) => Effect.Effect<ReadonlyArray<Evening>, DataSourceError>;
  /** The evening at `slug`, if the signer may help with it. */
  readonly evening: (
    signer: Signer,
    slug: string,
  ) => Effect.Effect<Option.Option<Evening>, DataSourceError>;
  /** The panel the signer sees under the evening's page. */
  readonly panel: (
    signer: Signer,
    evening: Evening,
  ) => Effect.Effect<Panel, DataSourceError>;
  /**
   * Adds the signer's comment, and its line in the audit, in one
   * transaction; whether the tables' policies took it (a viewer's, or one
   * on a round they don't host, they refuse).
   */
  readonly comment: (
    signer: Signer,
    evening: Evening,
    comment: NewComment,
    request: RequestRecord,
    limits: WriteLimits,
  ) => Effect.Effect<WriteOutcome, DataSourceError>;
  /** The latest save of each round the signer may see (their own, or every one for an organizer). */
  readonly rounds: (
    signer: Signer,
    evening: Evening,
  ) => Effect.Effect<ReadonlyArray<StoredRound>, DataSourceError>;
  /** Who of the signer's invitations hosts `roundId`: the collaborator a save is in the name of. */
  readonly hostOf: (
    signer: Signer,
    evening: Evening,
    roundId: string,
  ) => Effect.Effect<string | null, DataSourceError>;
  /** Adds a sealed save, and its line in the audit, in one transaction. */
  readonly saveRound: (
    signer: Signer,
    evening: Evening,
    save: NewRoundSave,
    request: RequestRecord,
    limits: WriteLimits,
  ) => Effect.Effect<WriteOutcome, DataSourceError>;
  /**
   * Adds the venue's answer to an item, and its line in the audit, in one
   * transaction: as the venue the signer is invited as, on an item of that
   * evening. Only the venue answers: an organizer reads the answers here
   * and reviews them in the studio.
   */
  readonly confirm: (
    signer: Signer,
    evening: Evening,
    confirmation: NewConfirmation,
    request: RequestRecord,
    limits: WriteLimits,
  ) => Effect.Effect<WriteOutcome, DataSourceError>;
  /** A line in the audit, in the signer's name, on its own: for what was refused. */
  readonly record: (
    signer: Signer,
    entry: AuditLine,
  ) => Effect.Effect<void, DataSourceError>;
}

/**
 * How many writes a signer may make, counted from the audit: the actions
 * that count, and at most how many in ten minutes and in a day.
 */
export interface WriteLimits {
  readonly actions: ReadonlyArray<string>;
  readonly tenMinutes: number;
  readonly day: number;
}

/** What became of a write: taken, refused by who may write there, or over the limits. */
export type WriteOutcome = "ok" | "refused" | "limited";

/** A round's latest save the signer may see, still sealed, with its latest review. */
export const StoredRound = Schema.Struct({
  id: Schema.String,
  roundId: Schema.String,
  collaboratorId: Schema.String,
  by: Schema.NullOr(Schema.String),
  stage: Schema.Literals(["draft", "final"]),
  keyId: Schema.String,
  nonce: Schema.Uint8Array,
  ciphertext: Schema.Uint8Array,
  at: Schema.String,
  decision: Schema.NullOr(Schema.String),
  note: Schema.NullOr(Schema.String),
});
export type StoredRound = typeof StoredRound.Type;

/** A save as the Worker adds it: sealed for the id it was given. */
export interface NewRoundSave {
  readonly id: string;
  readonly roundId: string;
  readonly collaboratorId: string;
  readonly stage: "draft" | "final";
  readonly keyId: string;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

/** A comment as the Worker adds it, once its form is checked. */
export interface NewComment {
  readonly body: string;
  readonly sectionId: string | null;
  readonly roundId: string | null;
}

/** Which request did it: Cloudflare's ray, for the audit. */
export interface RequestRecord {
  readonly requestId: string | null;
}

/** One line of the audit (planning.collab_audit). */
export interface AuditLine extends RequestRecord {
  readonly eventId: string | null;
  readonly action: string;
  readonly outcome: "ok" | "refused" | "invalid" | "limited";
  readonly targetId: string | null;
  readonly detail: string | null;
}

const iso = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient;

  /** `effect` in a transaction that says who is asking, as draft_collab. */
  const as = <A>(
    signer: Signer,
    effect: Effect.Effect<A, SqlError | Schema.SchemaError>,
  ): Effect.Effect<A, DataSourceError> =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT set_config('collab.email', ${signer.email}, true), set_config('collab.organizer', ${signer.organizer ? "on" : ""}, true)`;
          yield* sql.unsafe(`SET LOCAL ROLE ${COLLAB_ROLE}`);
          return yield* effect;
        }),
      )
      .pipe(
        Effect.catchTag(["SqlError", "SchemaError"], (cause) =>
          Effect.fail(new DataSourceError({ cause })),
        ),
      );

  const rows =
    <S extends Schema.Top>(schema: S) =>
    (raw: unknown) =>
      Schema.decodeUnknownEffect(Schema.Array(schema))(raw);

  /** The signer's evenings: their invitations', or, for an organizer, every draft and every evening with collaborators. */
  const eveningsWhere = (filter: string, values: ReadonlyArray<unknown>) =>
    sql
      .unsafe(
        `SELECT e.id, e.slug, e.is_draft AS "isDraft",
           COALESCE((SELECT array_agg(DISTINCT m.role ORDER BY m.role) FROM planning.collab_memberships() m WHERE m.event_id = e.id), '{}') AS roles
         FROM public.events e
         WHERE (e.id IN (SELECT m.event_id FROM planning.collab_memberships() m)
           OR (planning.collab_is_organizer()
             AND (e.is_draft OR EXISTS (SELECT 1 FROM planning.collab_roster(e.id)))))
           ${filter}
         ORDER BY e.slug`,
        [...values],
      )
      .pipe(Effect.flatMap(rows(Evening)));

  const evenings: CollabShape["evenings"] = (signer) =>
    as(signer, eveningsWhere("", []));

  const evening: CollabShape["evening"] = (signer, slug) =>
    as(signer, eveningsWhere("AND e.slug = $1", [slug])).pipe(
      Effect.map((found) => Option.fromNullishOr(found[0])),
    );

  const panel: CollabShape["panel"] = (signer, on) =>
    as(
      signer,
      Effect.gen(function* () {
        const mine = yield* sql`
          SELECT m.role, m.name, m.round_id AS "roundId" FROM planning.collab_memberships() m
          WHERE m.event_id = ${on.id} ORDER BY m.role`.pipe(
          Effect.flatMap(
            rows(
              Schema.Struct({
                role: Schema.String,
                name: Schema.String,
                roundId: Schema.NullOr(Schema.String),
              }),
            ),
          ),
        );
        const people = yield* sql`
          SELECT p.name, p.role, r.position AS round, p.email
          FROM planning.collab_roster(${on.id}) p
          LEFT JOIN planning.rounds r ON r.id = p.round_id
          ORDER BY p.role, p.name`.pipe(Effect.flatMap(rows(Person)));
        const rounds = yield* sql`
          SELECT id, position, title, questions, backups FROM planning.rounds
          WHERE event_id = ${on.id} ORDER BY position`.pipe(
          Effect.flatMap(rows(PanelRound)),
        );
        const brief = yield* sql`
          SELECT id, heading, body, audiences FROM planning.brief_sections
          WHERE event_id = ${on.id} ORDER BY position`.pipe(
          Effect.flatMap(rows(Section)),
        );
        const tasks = yield* sql`
          SELECT title, due_on::text AS "dueOn", done_at IS NOT NULL AS done FROM planning.tasks
          WHERE event_id = ${on.id} ORDER BY due_on NULLS LAST, title`.pipe(
          Effect.flatMap(rows(PanelTask)),
        );
        const comments = yield* sql`
          SELECT id, author_name AS by, section_id AS "sectionId", round_id AS "roundId", body,
            ${sql.unsafe(iso("created_at"))} AS at
          FROM planning.comments WHERE event_id = ${on.id} ORDER BY created_at, id`.pipe(
          Effect.flatMap(rows(PanelComment)),
        );
        const logistics = yield* sql`
          SELECT i.id, i.label, i.detail,
            (SELECT json_build_object(
                'answer', l.answer, 'note', l.note,
                'by', (SELECT p.name FROM planning.collab_roster(i.event_id) p WHERE p.collaborator_id = l.collaborator_id),
                'at', ${sql.unsafe(iso("l.created_at"))},
                'decision', (SELECT v.decision FROM planning.reviews v WHERE v.logistics_confirmation_id = l.id
                  ORDER BY v.created_at DESC, v.id LIMIT 1))
              FROM planning.logistics_confirmations l WHERE l.item_id = i.id
              ORDER BY l.created_at DESC, l.id DESC LIMIT 1) AS latest
          FROM planning.logistics_items i WHERE i.event_id = ${on.id} ORDER BY i.position`.pipe(
          Effect.flatMap(rows(PanelLogistics)),
        );
        const roles =
          signer.organizer && !mine.some((m) => m.role === "organizer")
            ? ["organizer", ...mine.map((m) => m.role)]
            : mine.map((m) => m.role);
        return {
          roles,
          name: mine[0]?.name ?? null,
          people,
          rounds,
          hosts: mine.flatMap((m) => (m.roundId === null ? [] : [m.roundId])),
          brief,
          tasks,
          comments,
          logistics,
        } satisfies Panel;
      }),
    );

  const insertAudit = (signer: Signer, entry: AuditLine) =>
    sql`
      INSERT INTO planning.collab_audit (actor_email, event_id, action, target_id, outcome, request_id, detail)
      VALUES (${signer.email}, ${entry.eventId}, ${entry.action}, ${entry.targetId}, ${entry.outcome},
        ${entry.requestId === null ? null : entry.requestId.slice(0, 64)},
        ${entry.detail === null ? null : entry.detail.slice(0, 500)})`;

  /**
   * Whether the signer is over `limits`, asked inside the write's own
   * transaction once it holds the signer's lock: requests sent at once wait
   * their turn, and each counts the ones before it.
   */
  const overLimits = (signer: Signer, limits: WriteLimits) =>
    Effect.gen(function* () {
      yield* sql`SELECT pg_advisory_xact_lock(hashtext(${`collab-writes:${signer.email}`}))`;
      const [counted] = yield* sql`
        SELECT planning.collab_recent_actions(now() - interval '10 minutes', ${limits.actions})::int AS lately,
          planning.collab_recent_actions(now() - interval '1 day', ${limits.actions})::int AS today`.pipe(
        Effect.flatMap(
          rows(Schema.Struct({ lately: Schema.Int, today: Schema.Int })),
        ),
      );
      return (
        (counted?.lately ?? 0) >= limits.tenMinutes ||
        (counted?.today ?? 0) >= limits.day
      );
    });

  const comment: CollabShape["comment"] = (
    signer,
    on,
    added,
    request,
    limits,
  ) =>
    as(
      signer,
      Effect.gen(function* () {
        if (yield* overLimits(signer, limits)) return "limited" as const;
        // Asked first, as the policies would answer it: they refuse the
        // same rows whatever this says, and a refusal there is a failure.
        const [may] = yield* sql`
          SELECT planning.collab_has_role(${on.id}, '{commenter,round_host,venue}')
            AND (${added.sectionId}::uuid IS NULL OR EXISTS (
              SELECT 1 FROM planning.brief_sections b WHERE b.id = ${added.sectionId}::uuid AND b.event_id = ${on.id}))
            AND (${added.roundId}::uuid IS NULL
              OR (EXISTS (SELECT 1 FROM planning.rounds r WHERE r.id = ${added.roundId}::uuid AND r.event_id = ${on.id})
                AND (planning.collab_has_role(${on.id}, '{organizer}') OR planning.collab_hosts(${added.roundId}::uuid))))
            AS allowed`.pipe(
          Effect.flatMap(rows(Schema.Struct({ allowed: Schema.Boolean }))),
        );
        if (may?.allowed !== true) return "refused" as const;
        const [mine] = yield* sql`
          SELECT m.collaborator_id AS id, m.name FROM planning.collab_memberships() m
          WHERE m.event_id = ${on.id} ORDER BY m.role = 'organizer' DESC, m.role LIMIT 1`.pipe(
          Effect.flatMap(
            rows(Schema.Struct({ id: Schema.String, name: Schema.String })),
          ),
        );
        const id = crypto.randomUUID();
        yield* sql`
          INSERT INTO planning.comments (id, event_id, collaborator_id, author_name, author_email, section_id, round_id, body)
          VALUES (${id}, ${on.id}, ${mine?.id ?? null}, ${mine?.name ?? "allthings"}, ${signer.email},
            ${added.sectionId}, ${added.roundId}, ${added.body})`;
        yield* insertAudit(signer, {
          ...request,
          eventId: on.id,
          action: "comment.add",
          outcome: "ok",
          targetId: id,
          detail: null,
        });
        return "ok" as const;
      }),
    );

  const rounds: CollabShape["rounds"] = (signer, on) =>
    as(
      signer,
      sql`
        SELECT s.id, s.round_id AS "roundId", s.collaborator_id AS "collaboratorId",
          (SELECT p.name FROM planning.collab_roster(${on.id}) p WHERE p.collaborator_id = s.collaborator_id) AS by,
          s.stage, s.key_id AS "keyId", s.nonce, s.ciphertext,
          ${sql.unsafe(iso("s.created_at"))} AS at,
          v.decision, v.note
        FROM planning.round_submissions s
        LEFT JOIN LATERAL (
          SELECT r.decision, r.note FROM planning.reviews r
          WHERE r.round_submission_id = s.id ORDER BY r.created_at DESC, r.id LIMIT 1
        ) v ON true
        WHERE s.event_id = ${on.id}
          AND NOT EXISTS (
            SELECT 1 FROM planning.round_submissions n
            WHERE n.round_id = s.round_id AND (n.created_at, n.id) > (s.created_at, s.id)
          )
        ORDER BY s.round_id`.pipe(Effect.flatMap(rows(StoredRound))),
    );

  const hostOf: CollabShape["hostOf"] = (signer, on, roundId) =>
    as(
      signer,
      sql`
        SELECT m.collaborator_id AS id FROM planning.collab_memberships() m
        WHERE m.event_id = ${on.id} AND m.role = 'round_host' AND m.round_id = ${roundId}::uuid
        LIMIT 1`.pipe(
        Effect.flatMap(rows(Schema.Struct({ id: Schema.String }))),
        Effect.map(([row]) => row?.id ?? null),
      ),
    );

  const saveRound: CollabShape["saveRound"] = (
    signer,
    on,
    save,
    request,
    limits,
  ) =>
    as(
      signer,
      Effect.gen(function* () {
        if (yield* overLimits(signer, limits)) return "limited" as const;
        yield* sql`
          INSERT INTO planning.round_submissions (id, event_id, round_id, collaborator_id, stage, key_id, nonce, ciphertext)
          VALUES (${save.id}, ${on.id}, ${save.roundId}, ${save.collaboratorId}, ${save.stage}, ${save.keyId},
            ${save.nonce}, ${save.ciphertext})`;
        yield* insertAudit(signer, {
          ...request,
          eventId: on.id,
          action: "round.save",
          outcome: "ok",
          targetId: save.id,
          detail: save.stage,
        });
        return "ok" as const;
      }),
    );

  const confirm: CollabShape["confirm"] = (
    signer,
    on,
    confirmation,
    request,
    limits,
  ) =>
    as(
      signer,
      Effect.gen(function* () {
        if (yield* overLimits(signer, limits)) return "limited" as const;
        // Asked first, as the policies would answer it.
        const [venue] = yield* sql`
          SELECT m.collaborator_id AS id FROM planning.collab_memberships() m
          WHERE m.event_id = ${on.id} AND m.role = 'venue'
            AND EXISTS (SELECT 1 FROM planning.logistics_items i
              WHERE i.id = ${confirmation.itemId}::uuid AND i.event_id = ${on.id})
          LIMIT 1`.pipe(
          Effect.flatMap(rows(Schema.Struct({ id: Schema.String }))),
        );
        if (venue === undefined) return "refused" as const;
        const id = crypto.randomUUID();
        yield* sql`
          INSERT INTO planning.logistics_confirmations (id, event_id, item_id, collaborator_id, answer, note)
          VALUES (${id}, ${on.id}, ${confirmation.itemId}, ${venue.id}, ${confirmation.answer}, ${confirmation.note})`;
        yield* insertAudit(signer, {
          ...request,
          eventId: on.id,
          action: "logistics.confirm",
          outcome: "ok",
          targetId: id,
          detail: confirmation.answer,
        });
        return "ok" as const;
      }),
    );

  const record: CollabShape["record"] = (signer, entry) =>
    as(signer, insertAudit(signer, entry).pipe(Effect.asVoid));

  return {
    evenings,
    evening,
    panel,
    comment,
    rounds,
    hostOf,
    saveRound,
    confirm,
    record,
  } satisfies CollabShape;
});

export class Collab extends Context.Service<Collab, CollabShape>()(
  "allthings/web/preview/Collab",
) {
  static readonly layer = Layer.effect(Collab, make);
}

/** What the Worker reads from its `COLLAB` Hyperdrive binding. */
interface HyperdriveBinding {
  readonly connectionString: string;
}

const isHyperdriveBinding = (value: unknown): value is HyperdriveBinding =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { connectionString?: unknown }).connectionString ===
    "string";

/**
 * Where collaboration is read: the `COLLAB` Hyperdrive, or, in tests,
 * `COLLAB_DATABASE_URL`. Without either, none: collaborators are refused
 * and organizers see drafts without the panel.
 */
export const collabUrl = (
  env: Readonly<Record<string, unknown>>,
): Option.Option<string> => {
  const binding = env["COLLAB"];
  if (isHyperdriveBinding(binding))
    return Option.some(binding.connectionString);
  const url = env["COLLAB_DATABASE_URL"];
  return typeof url === "string" && url !== ""
    ? Option.some(url)
    : Option.none();
};

/** A request's collaboration reads, over its own pool (see web/src/database.ts on why per request). */
export const collabLayer = (url: string) =>
  Layer.effectContext(
    Layer.build(
      Collab.layer.pipe(
        Layer.provide(PgClient.layer({ url: Redacted.make(url), ssl: false })),
      ),
    ).pipe(Effect.mapError((cause) => new DataSourceError({ cause }))),
  );
