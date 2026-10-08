import { writeFile } from "node:fs/promises";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer, Option, Result, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as Database from "../src/database.ts";
import {
  AccessError,
  AccessList,
  type ListSync,
} from "../src/collab/access.ts";
import { parseBrief } from "../src/collab/brief.ts";
import { keyProblem } from "../src/collab/seal.ts";
import {
  type Approval,
  Collab,
  type OpenedText,
} from "../src/collab/collab.ts";
import { approvalToken } from "../src/approval.ts";
import {
  describeBrief,
  describeInvitation,
  describeReview,
  describeRevocation,
  formatApproval,
  formatAuditEntries,
  formatBrief,
  formatCollaborators,
  formatComment,
  formatComments,
  formatLogistics,
  formatLogisticsItem,
  formatRound,
  formatRounds,
  formatSubmissions,
  formatTask,
  formatTasks,
} from "../src/collab/format.ts";
import { Decision, NewRound, NewTask, Role } from "../src/collab/model.ts";
import { rollingBackIf } from "../src/planning/dry-run.ts";
import { PlanningError } from "../src/planning/planning.ts";

/**
 * Collaborating on a draft (src/collab/; README, "Collaborating on a
 * draft"), the studio's side, at the Postgres at DATABASE_URL. Every
 * command takes --json, which the admin MCP server's collab tools read.
 *
 *   bun run collab invite <slug> --email … --name … --role round_host --round 5   read it, and its token
 *   bun run collab invite <slug> --email … --name … --role round_host --round 5 --approve <token>
 *   bun run collab revoke <slug> --email … [--approve <token>]
 *   bun run collab list <slug>
 *   bun run collab round add <slug> --position 5 --title AI [--questions 8 --backups 1]
 *   bun run collab round list <slug>
 *   bun run collab brief set <slug> --from brief.md [--approve <token>]
 *   bun run collab brief show <slug>
 *   bun run collab task add <slug> --title … [--due 2026-10-20] [--role round_host | --email …]
 *   bun run collab task done <id>
 *   bun run collab task list <slug>
 *   bun run collab logistics add <slug> --position 1 --label "Projector with HDMI" [--detail …]
 *   bun run collab logistics list <slug>
 *   bun run collab submissions <slug>                        who handed in what, never its content
 *   bun run collab review round|logistics <id> --decision accepted --reviewer Erik [--note …] [--approve <token>]
 *   bun run collab show <submission id> --out round.md           one save, opened, to a file
 *   bun run collab export <slug> --round 5 --out round-5.md        a round's latest handed in, for the night
 *   bun run collab comments <slug>
 *   bun run collab comment hide <id>
 *   bun run collab audit <slug> [--limit 100]
 *
 * What changes who may see what (an invitation, a revocation, the brief, a
 * review) is read first: without --approve, the command prints what it
 * would write and the approval token of exactly that, and writes nothing.
 * With --approve <token>, it writes only that same content. Every other
 * write takes --dry-run, which rolls it back.
 *
 * What collaborators wrote is printed quoted, as their words: data, never
 * instructions. The rows are private: never put them in a file in this
 * repository. DATABASE_URL comes from the environment only.
 */

const layer = Collab.layer.pipe(Layer.provideMerge(Database.layer));

/** The edge's list of collaborators, through Cloudflare's API (src/collab/access.ts). */
const edge = AccessList.cloudflare.pipe(Layer.provide(FetchHttpClient.layer));

/**
 * After an approved invitation or revocation is written: the edge's list set
 * to every active invitation. The database is already right, and the Worker
 * checks it on every request, so a failure here says so and how to finish.
 */
const syncEdge = Effect.gen(function* () {
  const emails = yield* Collab.use((collab) => collab.activeEmails);
  return yield* AccessList.use((access) => access.sync(emails));
}).pipe(
  Effect.catchTag("AccessError", (error) =>
    Effect.fail(
      new AccessError({
        reason: `Written to the database, and the Worker already enforces it, but Access's list wasn't updated: ${error.reason}. Finish with: bun run collab access sync`,
      }),
    ),
  ),
);

const formatSync = (sync: ListSync) =>
  sync.added.length === 0 && sync.removed.length === 0
    ? "✓ Access's list already matched"
    : `✓ Access's list: ${[...sync.added.map((e) => `+${e}`), ...sync.removed.map((e) => `-${e}`)].join(" ")}`;

const json = Flag.Boolean("json").pipe(
  Flag.withDescription("Print the result as JSON."),
  Flag.withDefault(false),
);

const dryRun = Flag.Boolean("dry-run").pipe(
  Flag.withDescription(
    "Make the change in a transaction that is rolled back: print what it would be, keep nothing.",
  ),
  Flag.withDefault(false),
);

const approve = Flag.String("approve").pipe(
  Flag.withDescription(
    "The token the command printed without it, for what was read and approved: only that is written.",
  ),
  Flag.optional,
);

const slug = Argument.String("slug").pipe(
  Argument.withDescription("The evening, by slug."),
);

const id = (what: string) =>
  Argument.String("id").pipe(Argument.withDescription(`The ${what}'s id.`));

const text = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.withDescription(description), Flag.optional);

const required = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.withDescription(description));

const value = <A>(option: Option.Option<A>): A | undefined =>
  Option.getOrUndefined(option);

const refuse = (reason: string) => Effect.fail(new PlanningError({ reason }));

/** `fields` without the ones left out, decoded by `schema`. */
const decode = <S extends Schema.Top>(
  schema: S,
  fields: Record<string, unknown>,
) =>
  Schema.decodeUnknownEffect(schema)(
    Object.fromEntries(
      Object.entries(fields).filter(([, field]) => field !== undefined),
    ),
  ).pipe(
    Effect.mapError((error) => new PlanningError({ reason: error.message })),
  );

const print = <A>(asJson: boolean, result: A, format: (result: A) => string) =>
  Console.log(asJson ? JSON.stringify(result, null, 2) : format(result));

const dryRunNote = (options: {
  readonly dryRun: boolean;
  readonly json: boolean;
}) =>
  options.dryRun && !options.json
    ? Console.log("Dry run: rolled back, nothing was kept.")
    : Effect.void;

/** Prints an approval, as text with the command that writes it, or as JSON. */
const printApproval = <P>(
  asJson: boolean,
  approval: Approval<P>,
  describe: (plan: P) => string,
  command: string,
) =>
  print(asJson, approval, (result) =>
    formatApproval(result, describe, command),
  );

/** `args` quoted for a shell, to print the command that writes what was read. */
const shell = (args: ReadonlyArray<string>) =>
  args
    .map((arg) =>
      /^[\w@.:/=+-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`,
    )
    .join(" ");

const invite = Command.make(
  "invite",
  {
    slug,
    email: required("email", "The email they sign in to Access with."),
    name: required("name", "The name the other collaborators see."),
    role: Flag.Literals("role", Role.literals).pipe(
      Flag.withDescription(`What they may do (${Role.literals.join(", ")}).`),
    ),
    round: Flag.Int("round").pipe(
      Flag.withDescription("A round host's round, by its position."),
      Flag.optional,
    ),
    approve,
    json,
  },
  (options) =>
    Effect.gen(function* () {
      const round = value(options.round);
      // Before anything is written: the edge can be updated too.
      if (Option.isSome(options.approve)) {
        yield* AccessList.use((access) => access.ready);
      }
      const approval = yield* Collab.use((collab) =>
        collab.invite(
          {
            event: options.slug,
            email: options.email,
            name: options.name,
            role: options.role,
            ...(round === undefined ? {} : { round }),
          },
          value(options.approve),
        ),
      );
      yield* printApproval(
        options.json,
        approval,
        describeInvitation,
        `bun run collab invite ${shell([
          options.slug,
          "--email",
          approval.plan.email,
          "--name",
          approval.plan.name,
          "--role",
          approval.plan.role,
          ...(round === undefined ? [] : ["--round", String(round)]),
        ])}`,
      );
      if (approval.written) {
        const synced = yield* syncEdge;
        if (!options.json) yield* Console.log(formatSync(synced));
      }
    }).pipe(Effect.provide(Layer.mergeAll(layer, edge))),
).pipe(
  Command.withDescription(
    "Invite someone to help with an evening: read it and its token, then write it with --approve.",
  ),
);

const revoke = Command.make(
  "revoke",
  { slug, email: required("email", "Whose invitation."), approve, json },
  (options) =>
    Effect.gen(function* () {
      if (Option.isSome(options.approve)) {
        yield* AccessList.use((access) => access.ready);
      }
      const approval = yield* Collab.use((collab) =>
        collab.revoke(
          { event: options.slug, email: options.email },
          value(options.approve),
        ),
      );
      yield* printApproval(
        options.json,
        approval,
        describeRevocation,
        `bun run collab revoke ${shell([options.slug, "--email", approval.plan.email])}`,
      );
      if (approval.written) {
        // Both steps run whatever the other does: the list, so signing in
        // again is turned away at the edge, and the sessions they already
        // hold. Either failing says what's left, and how to finish it.
        const email = approval.plan.email;
        const synced = yield* Effect.result(syncEdge);
        const ended = yield* Effect.result(
          AccessList.use((access) => access.revokeSessions(email)),
        );
        const left = [
          ...(Result.isFailure(synced) ? [synced.failure.message] : []),
          ...(Result.isFailure(ended)
            ? [
                `Their Access sessions weren't ended: ${ended.failure.reason}. Finish with: bun run collab access end-sessions --email ${email}`,
              ]
            : []),
        ];
        if (!options.json) {
          if (Result.isSuccess(synced)) {
            yield* Console.log(formatSync(synced.success));
          }
          if (Result.isSuccess(ended)) {
            yield* Console.log(`✓ ended ${email}'s Access sessions`);
          }
        }
        if (left.length > 0) {
          return yield* new AccessError({
            reason: `Revoked in the database, which the Worker enforces on every request. ${left.join(" ")}`,
          });
        }
      }
      return undefined;
    }).pipe(Effect.provide(Layer.mergeAll(layer, edge))),
).pipe(
  Command.withDescription(
    "Revoke an invitation: from the next request on, they see nothing.",
  ),
);

const list = Command.make("list", { slug, json }, (options) =>
  Collab.use((collab) => collab.collaborators(options.slug)).pipe(
    Effect.flatMap((rows) => print(options.json, rows, formatCollaborators)),
    Effect.provide(layer),
  ),
).pipe(Command.withDescription("Everyone invited to an evening, with emails."));

const roundAdd = Command.make(
  "add",
  {
    slug,
    position: Flag.Int("position").pipe(
      Flag.withDescription("Its place in the evening, from 1."),
    ),
    title: required("title", "What it's called."),
    questions: Flag.Int("questions").pipe(
      Flag.withDescription("Questions in it (default 8)."),
      Flag.optional,
    ),
    backups: Flag.Int("backups").pipe(
      Flag.withDescription("Backup questions (default 1)."),
      Flag.optional,
    ),
    dryRun,
    json,
  },
  (options) =>
    Effect.gen(function* () {
      const round = yield* decode(NewRound, {
        position: options.position,
        title: options.title,
        questions: value(options.questions),
        backups: value(options.backups),
      });
      const added = yield* Collab.use((collab) =>
        collab.addRound(options.slug, round),
      );
      yield* print(options.json, added, formatRound);
    }).pipe(
      rollingBackIf(options.dryRun),
      Effect.tap(() => dryRunNote(options)),
      Effect.provide(layer),
    ),
).pipe(
  Command.withDescription("Add a round to an evening, for its host to write."),
);

const roundList = Command.make("list", { slug, json }, (options) =>
  Collab.use((collab) => collab.rounds(options.slug)).pipe(
    Effect.flatMap((rows) => print(options.json, rows, formatRounds)),
    Effect.provide(layer),
  ),
).pipe(Command.withDescription("An evening's rounds and their hosts."));

const round = Command.make("round").pipe(
  Command.withDescription("An evening's rounds."),
  Command.withSubcommands([roundAdd, roundList]),
);

const briefSet = Command.make(
  "set",
  {
    slug,
    from: Flag.FileText("from").pipe(
      Flag.withDescription(
        'The brief as Markdown: each "## " section\'s first line is <!-- for: roles -->.',
      ),
    ),
    approve,
    json,
  },
  (options) =>
    Effect.gen(function* () {
      const sections = parseBrief(options.from);
      if (typeof sections === "string") return yield* refuse(sections);
      const approval = yield* Collab.use((collab) =>
        collab.setBrief(options.slug, sections, value(options.approve)),
      );
      return yield* printApproval(
        options.json,
        approval,
        describeBrief,
        `bun run collab brief set ${shell([options.slug])} --from <the same file>`,
      );
    }).pipe(Effect.provide(layer)),
).pipe(
  Command.withDescription(
    "Set an evening's brief from Markdown, a section per role's audience: read it and its token, then write it with --approve.",
  ),
);

const briefShow = Command.make("show", { slug, json }, (options) =>
  Collab.use((collab) => collab.brief(options.slug)).pipe(
    Effect.flatMap((rows) => print(options.json, rows, formatBrief)),
    Effect.provide(layer),
  ),
).pipe(Command.withDescription("An evening's brief, section by section."));

const brief = Command.make("brief").pipe(
  Command.withDescription("The brief collaborators read."),
  Command.withSubcommands([briefSet, briefShow]),
);

const taskAdd = Command.make(
  "add",
  {
    slug,
    title: required("title", "What to do."),
    due: text("due", "By when, YYYY-MM-DD."),
    role: Flag.Literals("role", Role.literals).pipe(
      Flag.withDescription("For everyone with this role."),
      Flag.optional,
    ),
    email: text("email", "For one collaborator, by email."),
    dryRun,
    json,
  },
  (options) =>
    Effect.gen(function* () {
      const task = yield* decode(NewTask, {
        title: options.title,
        dueOn: value(options.due),
        role: value(options.role),
        email: value(options.email)?.trim().toLowerCase(),
      });
      const added = yield* Collab.use((collab) =>
        collab.addTask(options.slug, task),
      );
      yield* print(options.json, added, formatTask);
    }).pipe(
      rollingBackIf(options.dryRun),
      Effect.tap(() => dryRunNote(options)),
      Effect.provide(layer),
    ),
).pipe(
  Command.withDescription("Give collaborators something to do, by a date."),
);

const taskDone = Command.make(
  "done",
  { id: id("task"), dryRun, json },
  (options) =>
    Collab.use((collab) => collab.finishTask(options.id)).pipe(
      Effect.flatMap((task) => print(options.json, task, formatTask)),
      rollingBackIf(options.dryRun),
      Effect.tap(() => dryRunNote(options)),
      Effect.provide(layer),
    ),
).pipe(Command.withDescription("Mark a task done."));

const taskList = Command.make("list", { slug, json }, (options) =>
  Collab.use((collab) => collab.tasks(options.slug)).pipe(
    Effect.flatMap((rows) => print(options.json, rows, formatTasks)),
    Effect.provide(layer),
  ),
).pipe(Command.withDescription("An evening's tasks, soonest first."));

const task = Command.make("task").pipe(
  Command.withDescription("What collaborators have to do, and by when."),
  Command.withSubcommands([taskAdd, taskDone, taskList]),
);

const logisticsAdd = Command.make(
  "add",
  {
    slug,
    position: Flag.Int("position").pipe(
      Flag.withDescription("Its place in the list, from 1."),
    ),
    label: required("label", "What the venue confirms."),
    detail: text("detail", "What exactly we need."),
    dryRun,
    json,
  },
  (options) =>
    Effect.gen(function* () {
      const detail = value(options.detail);
      const added = yield* Collab.use((collab) =>
        collab.addLogisticsItem(options.slug, {
          position: options.position,
          label: options.label,
          ...(detail === undefined ? {} : { detail }),
        }),
      );
      yield* print(options.json, added, formatLogisticsItem);
    }).pipe(
      rollingBackIf(options.dryRun),
      Effect.tap(() => dryRunNote(options)),
      Effect.provide(layer),
    ),
).pipe(Command.withDescription("Ask the venue to confirm something."));

const logisticsList = Command.make("list", { slug, json }, (options) =>
  Collab.use((collab) => collab.logistics(options.slug)).pipe(
    Effect.flatMap((rows) => print(options.json, rows, formatLogistics)),
    Effect.provide(layer),
  ),
).pipe(
  Command.withDescription("What the venue was asked, and its latest answers."),
);

const logistics = Command.make("logistics").pipe(
  Command.withDescription("What the venue confirms."),
  Command.withSubcommands([logisticsAdd, logisticsList]),
);

const submissions = Command.make("submissions", { slug, json }, (options) =>
  Collab.use((collab) => collab.submissions(options.slug)).pipe(
    Effect.flatMap((rows) => print(options.json, rows, formatSubmissions)),
    Effect.provide(layer),
  ),
).pipe(
  Command.withDescription(
    "Who handed in which round when, and its review: never the questions, which stay sealed.",
  ),
);

const review = Command.make(
  "review",
  {
    subject: Argument.Literals("subject", ["round", "logistics"] as const).pipe(
      Argument.withDescription("A round submission, or a logistics answer."),
    ),
    id: id("submission or answer"),
    decision: Flag.Literals("decision", Decision.literals).pipe(
      Flag.withDescription(`The decision (${Decision.literals.join(", ")}).`),
    ),
    reviewer: required("reviewer", "Who decides, as they sign."),
    note: text("note", "Why, for the collaborator."),
    approve,
    json,
  },
  (options) =>
    Effect.gen(function* () {
      const note = value(options.note);
      const approval = yield* Collab.use((collab) =>
        collab.review(
          {
            subject: options.subject,
            id: options.id,
            decision: options.decision,
            reviewer: options.reviewer,
            ...(note === undefined ? {} : { note }),
          },
          value(options.approve),
        ),
      );
      yield* printApproval(
        options.json,
        approval,
        describeReview,
        `bun run collab review ${shell([
          options.subject,
          options.id,
          "--decision",
          options.decision,
          "--reviewer",
          approval.plan.reviewer,
          ...(note === undefined ? [] : ["--note", note]),
        ])}`,
      );
    }).pipe(Effect.provide(layer)),
).pipe(
  Command.withDescription(
    "Accept, reject or ask for changes to what was handed in: read it and its token, then write it with --approve.",
  ),
);

/**
 * The answers keys from the environment: COLLAB_ANSWERS_KEY ("allthings
 * collab answers key" in 1Password), then COLLAB_ANSWERS_PREVIOUS_KEY if a
 * rotation left one. Never printed.
 */
const answersKeys = Effect.gen(function* () {
  const current = process.env["COLLAB_ANSWERS_KEY"] ?? "";
  if (current === "") {
    return yield* refuse(
      'COLLAB_ANSWERS_KEY is not set: pass it from 1Password ("allthings collab answers key") without printing it.',
    );
  }
  const problem = keyProblem(current);
  if (problem !== undefined) return yield* refuse(problem);
  const previous = process.env["COLLAB_ANSWERS_PREVIOUS_KEY"] ?? "";
  if (previous === "") return [current];
  const previousProblem = keyProblem(previous, "COLLAB_ANSWERS_PREVIOUS_KEY");
  if (previousProblem !== undefined) return yield* refuse(previousProblem);
  return [current, previous];
});

const outFlags = {
  out: Flag.String("out").pipe(
    Flag.withDescription(
      "The file to write, only you may read it; it must not exist yet.",
    ),
    Flag.optional,
  ),
  stdout: Flag.Boolean("stdout").pipe(
    Flag.withDescription("Print the answer key instead of writing a file."),
    Flag.withDefault(false),
  ),
};

/** Writes an opened round where asked: a new file only its owner reads, or stdout when asked outright. */
const deliver = (
  opened: OpenedText,
  options: {
    readonly out: Option.Option<string>;
    readonly stdout: boolean;
    readonly json: boolean;
  },
) =>
  Effect.gen(function* () {
    if (options.stdout === Option.isSome(options.out)) {
      return yield* refuse(
        "Give --out <file> to write it, or --stdout to print it.",
      );
    }
    if (options.stdout) return yield* Console.log(opened.text);
    const path = Option.getOrThrow(options.out);
    yield* Effect.tryPromise({
      try: () =>
        writeFile(path, `${opened.text}\n`, { mode: 0o600, flag: "wx" }),
      catch: (cause) =>
        new PlanningError({
          reason: `Couldn't write ${path}: ${cause instanceof Error ? cause.message : String(cause)}. It must not exist yet.`,
        }),
    });
    const digest = yield* approvalToken(opened.text);
    const result = {
      submission: opened.submission,
      round: opened.round,
      stage: opened.stage,
      decision: opened.decision,
      path,
      digest,
    };
    return yield* print(
      options.json,
      result,
      (r) =>
        `✓ round ${r.round} (${r.stage}, ${r.decision ?? "not reviewed"}) from submission ${r.submission}, to ${r.path} (digest ${r.digest})`,
    );
  });

const show = Command.make(
  "show",
  { id: id("submission"), ...outFlags, json },
  (options) =>
    Effect.gen(function* () {
      const keys = yield* answersKeys;
      const opened = yield* Collab.use((collab) =>
        collab.openRound({ submission: options.id }, keys),
      );
      yield* deliver(opened, options);
    }).pipe(Effect.provide(layer)),
).pipe(
  Command.withDescription(
    "Open one round submission: its questions and answer key, to a file only you may read.",
  ),
);

const exportRound = Command.make(
  "export",
  {
    slug,
    round: Flag.Int("round").pipe(
      Flag.withDescription("The round, by its position."),
    ),
    ...outFlags,
    json,
  },
  (options) =>
    Effect.gen(function* () {
      const keys = yield* answersKeys;
      const opened = yield* Collab.use((collab) =>
        collab.openRound({ event: options.slug, round: options.round }, keys),
      );
      yield* deliver(opened, options);
    }).pipe(Effect.provide(layer)),
).pipe(
  Command.withDescription(
    "A round's latest save handed in, as its answer key for the night, to a file only you may read.",
  ),
);

const comments = Command.make("comments", { slug, json }, (options) =>
  Collab.use((collab) => collab.comments(options.slug)).pipe(
    Effect.flatMap((rows) => print(options.json, rows, formatComments)),
    Effect.provide(layer),
  ),
).pipe(
  Command.withDescription("Every comment on an evening, hidden ones marked."),
);

const commentHide = Command.make(
  "hide",
  { id: id("comment"), dryRun, json },
  (options) =>
    Collab.use((collab) => collab.hideComment(options.id)).pipe(
      Effect.flatMap((row) => print(options.json, row, formatComment)),
      rollingBackIf(options.dryRun),
      Effect.tap(() => dryRunNote(options)),
      Effect.provide(layer),
    ),
).pipe(
  Command.withDescription(
    "Hide a comment from collaborators; it stays in the record.",
  ),
);

const comment = Command.make("comment").pipe(
  Command.withDescription("A comment."),
  Command.withSubcommands([commentHide]),
);

const audit = Command.make(
  "audit",
  {
    slug,
    limit: Flag.Int("limit").pipe(
      Flag.withDescription("At most this many, newest first (default 100)."),
      Flag.withDefault(100),
    ),
    json,
  },
  (options) =>
    Collab.use((collab) => collab.audit(options.slug, options.limit)).pipe(
      Effect.flatMap((rows) => print(options.json, rows, formatAuditEntries)),
      Effect.provide(layer),
    ),
).pipe(
  Command.withDescription(
    "What collaborators did on an evening, newest first.",
  ),
);

const accessSync = Command.make(
  "sync",
  {
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription(
        "Say what would change on Access's list, and change nothing.",
      ),
      Flag.withDefault(false),
    ),
    json,
  },
  (options) =>
    Effect.gen(function* () {
      const emails = yield* Collab.use((collab) => collab.activeEmails);
      const result = yield* AccessList.use((access) =>
        options.dryRun ? access.plan(emails) : access.sync(emails),
      );
      yield* print(options.json, result, (sync) =>
        options.dryRun
          ? `would change: ${[...sync.added.map((e) => `+${e}`), ...sync.removed.map((e) => `-${e}`)].join(" ") || "nothing"}`
          : formatSync(sync),
      );
    }).pipe(Effect.provide(Layer.mergeAll(layer, edge))),
).pipe(
  Command.withDescription(
    "Set Access's list of collaborators to every active invitation's email.",
  ),
);

const accessEndSessions = Command.make(
  "end-sessions",
  { email: required("email", "Whose sessions."), json },
  (options) =>
    Effect.gen(function* () {
      const email = options.email.trim().toLowerCase();
      yield* AccessList.use((access) => access.revokeSessions(email));
      yield* print(
        options.json,
        { email, ended: true },
        () => `✓ ended ${email}'s Access sessions`,
      );
    }).pipe(Effect.provide(edge)),
).pipe(Command.withDescription("End every Access session someone holds."));

const access = Command.make("access").pipe(
  Command.withDescription(
    "The edge: Access's list of collaborators, and their sessions.",
  ),
  Command.withSubcommands([accessSync, accessEndSessions]),
);

const collab = Command.make("collab").pipe(
  Command.withDescription(
    "Collaborating on a draft evening: invitations, rounds, the brief, tasks, logistics, reviews, comments and the audit.",
  ),
  Command.withSubcommands([
    invite,
    revoke,
    list,
    round,
    brief,
    task,
    logistics,
    submissions,
    review,
    show,
    exportRound,
    comments,
    comment,
    audit,
    access,
  ]),
);

// A refusal is the answer, not a crash: its reason alone, on stderr, and exit 1.
Command.run(collab, { version: "1.0.0" }).pipe(
  Effect.catchTag(["PlanningError", "AccessError"], (refusal) =>
    Effect.sync(() => {
      console.error(refusal.reason);
      process.exitCode = 1;
    }),
  ),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
