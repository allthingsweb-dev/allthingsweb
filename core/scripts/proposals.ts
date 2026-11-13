import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import { rollingBackIf } from "../src/planning/dry-run.ts";
import {
  decide,
  type Decision,
  type DecisionKind,
  getProposal,
  listProposals,
  planDecision,
  ProposalFormat,
  proposalLine,
  proposalLines,
  ProposalStatus,
  recordProposal,
} from "../src/proposals.ts";
import { shellWord } from "./shell.ts";

/**
 * Talk proposals, in the Postgres at DATABASE_URL (src/proposals.ts).
 *
 *   bun run proposals list [--status new|accepted|declined|all] [--json]
 *   bun run proposals show <id> [--json]
 *   bun run proposals add --title "…" --abstract "…" --name "…" --email "…"
 *     [--format talk|lightning|demo] [--about "…"] [--link https://…]… [--notes "…"]
 *     [--dry-run] [--json]
 *   bun run proposals accept <id> [--note "…"] --dry-run | --approve <token> [--json]
 *   bun run proposals decline <id> [--note "…"] --dry-run | --approve <token> [--json]
 *   bun run proposals remove <id> --dry-run | --approve <token> [--json]
 *
 * list prints the proposals with a status (new, by default), oldest first;
 * show prints one whole. Both only read.
 *
 * add records a proposal sent to an organizer, by email or a message, held
 * to the same limits as one sent through the site; --dry-run makes it and
 * rolls it back.
 *
 * accept, decline and remove decide one, exactly as a dry run showed it:
 * --dry-run prints the proposal, the decision and an approval token, and
 * changes nothing; --approve <token>, with the same values, makes exactly
 * that decision, or refuses it if the proposal changed since. remove
 * deletes it: spam, a test, or someone asking to be forgotten.
 *
 * Every write needs ALLTHINGS_ACTOR. DATABASE_URL (the studio's
 * connection string: core's README, "The studio's connection") comes from
 * the environment only; .env files are not read.
 */

const jsonFlag = Flag.Boolean("json").pipe(
  Flag.withDescription("Print the result as JSON."),
  Flag.withDefault(false),
);

const idArgument = Argument.String("id").pipe(
  Argument.withDescription("The proposal's id (proposals list shows it)."),
);

const list = Command.make(
  "list",
  {
    status: Flag.Literals("status", [
      ...ProposalStatus.literals,
      "all",
    ] as const).pipe(
      Flag.withDescription(
        "Which proposals: new (the default), accepted, declined or all.",
      ),
      Flag.withDefault("new" as const),
    ),
    json: jsonFlag,
  },
  ({ status, json }) =>
    Effect.gen(function* () {
      const proposals = yield* listProposals(status);
      yield* Console.log(
        json
          ? JSON.stringify(proposals, null, 2)
          : [
              `${proposals.length} ${status === "all" ? "" : `${status} `}proposal${proposals.length === 1 ? "" : "s"}, oldest first`,
              ...proposals.map(proposalLine),
            ].join("\n"),
      );
    }).pipe(Effect.provide(Database.scriptLayer)),
).pipe(
  Command.withDescription(
    "List proposals with a status, oldest first. Reads only.",
  ),
);

const show = Command.make(
  "show",
  { id: idArgument, json: jsonFlag },
  ({ id, json }) =>
    Effect.gen(function* () {
      const proposal = yield* getProposal(id);
      yield* Console.log(
        json
          ? JSON.stringify(proposal, null, 2)
          : proposalLines(proposal).join("\n"),
      );
    }).pipe(Effect.provide(Database.scriptLayer)),
).pipe(Command.withDescription("Show one proposal whole. Reads only."));

const add = Command.make(
  "add",
  {
    title: Flag.String("title").pipe(Flag.withDescription("The talk's title.")),
    abstract: Flag.String("abstract").pipe(
      Flag.withDescription("What the talk is about, in a few sentences."),
    ),
    name: Flag.String("name").pipe(
      Flag.withDescription("Who proposes it, as they gave their name."),
    ),
    email: Flag.String("email").pipe(
      Flag.withDescription("How to reach them."),
    ),
    format: Flag.Literals("format", ProposalFormat.literals).pipe(
      Flag.withDescription("talk (the default), lightning or demo."),
      Flag.optional,
    ),
    about: Flag.String("about").pipe(
      Flag.withDescription("A few lines about them."),
      Flag.optional,
    ),
    link: Flag.String("link").pipe(
      Flag.withDescription("An https link of theirs; up to four."),
      Flag.atLeast(0),
    ),
    notes: Flag.String("notes").pipe(
      Flag.withDescription("Anything else they said, for the organizers."),
      Flag.optional,
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Record it and roll it back: what it would be."),
      Flag.withDefault(false),
    ),
    json: jsonFlag,
  },
  (options) =>
    Effect.gen(function* () {
      const proposal = yield* recordProposal({
        title: options.title,
        abstract: options.abstract,
        name: options.name,
        email: options.email,
        format: Option.getOrUndefined(options.format),
        about: Option.getOrUndefined(options.about),
        links: options.link,
        notes: Option.getOrUndefined(options.notes),
      }).pipe(rollingBackIf(options.dryRun));
      yield* Console.log(
        options.json
          ? JSON.stringify({ dryRun: options.dryRun, proposal }, null, 2)
          : [
              options.dryRun
                ? "Dry run: rolled back, nothing was kept."
                : "Recorded:",
              ...proposalLines(proposal),
            ].join("\n"),
      );
    }).pipe(Effect.provide(Database.scriptLayer)),
).pipe(
  Command.withDescription(
    "Record a proposal sent to an organizer by email or a message.",
  ),
);

/** What each decision does, as a dry run says it. */
const doing: Readonly<Record<DecisionKind, string>> = {
  accept: "Accept it",
  decline: "Decline it",
  remove: "Remove it: delete it and everything it says",
};

const done: Readonly<Record<DecisionKind, string>> = {
  accept: "Accepted",
  decline: "Declined",
  remove: "Removed",
};

/** accept, decline or remove: a dry run, or the decision approved. */
const decision = (kind: DecisionKind, description: string) =>
  Command.make(
    kind,
    {
      id: idArgument,
      note: Flag.String("note").pipe(
        Flag.withDescription("Why, kept with the decision."),
        Flag.optional,
      ),
      dryRun: Flag.Boolean("dry-run").pipe(
        Flag.withDescription(
          "Print the proposal, the decision and its approval token; change nothing.",
        ),
        Flag.withDefault(false),
      ),
      approve: Flag.String("approve").pipe(
        Flag.withDescription(
          "The token --dry-run printed: make exactly that decision, or refuse if anything changed since.",
        ),
        Flag.optional,
      ),
      json: jsonFlag,
    },
    (options) =>
      Effect.gen(function* () {
        if (options.dryRun === Option.isSome(options.approve)) {
          return yield* Effect.fail(
            new Error(
              "Give --dry-run to read what would be decided, or --approve <token> to decide exactly that.",
            ),
          );
        }
        const asked: Decision = Option.match(options.note, {
          onNone: () => ({ kind }),
          onSome: (note) => ({ kind, note }),
        });
        if (Option.isNone(options.approve)) {
          const planned = yield* planDecision(options.id, asked);
          return yield* Console.log(
            options.json
              ? JSON.stringify({ dryRun: true, ...planned }, null, 2)
              : [
                  ...proposalLines(planned.proposal),
                  `decision: ${doing[kind]}${planned.decision.note === null ? "." : `, noting ${JSON.stringify(planned.decision.note)}.`}`,
                  `approval token: ${planned.token}`,
                  `Nothing was changed. To decide exactly this: ${[
                    "bun run proposals",
                    kind,
                    planned.proposal.id,
                    ...Option.match(options.note, {
                      onNone: () => [],
                      onSome: (note) => ["--note", shellWord(note)],
                    }),
                    "--approve",
                    planned.token,
                  ].join(" ")}`,
                ].join("\n"),
          );
        }
        const proposal = yield* decide(
          options.id,
          asked,
          options.approve.value,
        );
        return yield* Console.log(
          options.json
            ? JSON.stringify({ dryRun: false, kind, proposal }, null, 2)
            : [`${done[kind]}:`, ...proposalLines(proposal)].join("\n"),
        );
      }).pipe(Effect.provide(Database.scriptLayer)),
  ).pipe(Command.withDescription(description));

const proposals = Command.make("proposals").pipe(
  Command.withDescription(
    "Talk proposals: read them, record one, and accept, decline or remove one.",
  ),
  Command.withSubcommands([
    list,
    show,
    add,
    decision("accept", "Accept a proposal, exactly as a dry run showed it."),
    decision("decline", "Decline a proposal, exactly as a dry run showed it."),
    decision(
      "remove",
      "Delete a proposal (spam, a test, a request to be forgotten), exactly as a dry run showed it.",
    ),
  ]),
);

Command.run(proposals, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
