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
        } satisfies Panel;
      }),
    );

  return { evenings, evening, panel } satisfies CollabShape;
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
