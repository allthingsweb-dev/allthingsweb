import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, DateTime, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import {
  type Approval,
  approvals,
  editsOf,
  everyIssue,
  type Issue,
  issueToken,
  itemsOf,
  letterBudget,
  letterFindings,
  type LetterFinding,
  letterWords,
  plainText,
  proseParts,
  repeatsOfEdits,
  sectionOrder,
  sectionTitles,
  sourceFindings,
  sourceUrl,
  wordBudget,
  wordCount,
} from "../src/letter.ts";
import { sfDay } from "../src/readiness/calendar.ts";

/**
 * The letter's issues (src/letter.ts), for Claude to check a draft and for
 * Erik to read one and say y.
 *
 *   bun run letter list
 *   bun run letter show <yyyy-mm>
 *   bun run letter approve <yyyy-mm> --dry-run | --approve <token>
 *
 * list prints every issue, with whether it is a draft or approved. show
 * prints one as it reads, its words against each budget, every rule it
 * breaks and Erik's edits to it so far; it reads no database.
 *
 * approve --dry-run prints the same, with its evenings and talks checked
 * against the database (src/letter.ts, sourceFindings), and the approval
 * token of exactly what it printed; it writes nothing. approve --approve
 * <token> records Erik's y in core/letters/approvals.json for that token:
 * if the issue breaks a rule or changed since, nothing is written. Run it
 * only on Erik's own y for that token.
 *
 * DATABASE_URL comes from the environment only; .env files are not read.
 * approve only reads: production's read-only site_reader role is enough.
 * Nothing here sends anything.
 */

const monthArgument = Argument.String("month").pipe(
  Argument.withDescription("The issue's month, YYYY-MM."),
);

const findIssue = (month: string) =>
  Effect.fromNullishOr(everyIssue.find((issue) => issue.month === month)).pipe(
    Effect.mapError(() => new Error(`There is no issue for ${month}.`)),
  );

/** Whether `issue` is approved, as of what it says now. */
const stateOf = (issue: Issue) =>
  Effect.map(issueToken(issue), (token) => {
    const approval: Approval | undefined = approvals.find(
      (each) => each.month === issue.month,
    );
    return approval === undefined
      ? "a draft"
      : approval.token === token
        ? `approved on ${approval.on}`
        : `a draft: changed since Erik's y on ${approval.on}`;
  });

const list = Command.make("list", {}, () =>
  Effect.gen(function* () {
    if (everyIssue.length === 0) yield* Console.log("No issues yet.");
    for (const issue of everyIssue) {
      yield* Console.log(
        `${issue.month}  ${issue.title}  (${yield* stateOf(issue)})`,
      );
    }
  }),
).pipe(Command.withDescription("List every issue and whether it's approved."));

/** The addresses `text` links. */
const hrefs = (text: string): ReadonlyArray<string> =>
  proseParts(text).flatMap((part) => ("href" in part ? [part.href] : []));

/** `issue` as it reads, with each part's words against its budget. */
function reading(issue: Issue): string {
  const lines = [
    `${issue.title}  [${letterWords(issue)}/${letterBudget} words]`,
    "",
  ];
  for (const key of sectionOrder) {
    const items = issue[key];
    if (items === undefined) continue;
    const words = items.reduce(
      (sum, each) => sum + wordCount(each.name) + wordCount(each.text),
      0,
    );
    lines.push(`## ${sectionTitles[key]}  [${words}/${wordBudget[key]}]`, "");
    for (const each of items) {
      lines.push(
        `${each.name} (${sourceUrl(each.source)})`,
        plainText(each.text).replace(/\s+/g, " "),
        "",
      );
    }
  }
  if (issue.closing !== undefined) {
    lines.push(
      `## closing  [${wordCount(issue.closing)}/${wordBudget.closing}]`,
      "",
      plainText(issue.closing).replace(/\s+/g, " "),
      "",
    );
  }
  return lines.join("\n");
}

/** Prints `issue` as it reads, the rules it breaks, Erik's edits and every link it makes. */
const print = (issue: Issue, findings: ReadonlyArray<LetterFinding>) =>
  Effect.gen(function* () {
    yield* Console.log(reading(issue));
    yield* Console.log(
      findings.length === 0
        ? "It breaks no rule."
        : [
            "Rules it breaks:",
            ...findings.map(
              ({ where, why, said }) => `  ${where}: ${why} ("${said}")`,
            ),
          ].join("\n"),
    );
    const edits = editsOf(issue.month);
    yield* Console.log(
      `Erik's edits so far: ${edits.cut} cut, ${edits.reword} reworded, ${edits.fact} on facts.`,
    );
    yield* Console.log(`It's ${yield* stateOf(issue)}.`);
    // Every link it makes, so a reader can open each before saying y.
    const links = [
      ...itemsOf(issue).flatMap(({ item }) => [
        sourceUrl(item.source),
        ...hrefs(item.text),
      ]),
      ...(issue.closing === undefined ? [] : hrefs(issue.closing)),
    ];
    yield* Console.log(["Links:", ...new Set(links)].join("\n  "));
  });

/** The rules `issue` breaks that need no database. */
const offlineFindings = (issue: Issue) => [
  ...letterFindings(issue),
  ...repeatsOfEdits(issue),
];

const show = Command.make("show", { month: monthArgument }, ({ month }) =>
  Effect.gen(function* () {
    const issue = yield* findIssue(month);
    yield* print(issue, offlineFindings(issue));
    yield* Console.log(
      `To check its evenings and talks and get its approval token: bun run letter approve ${month} --dry-run`,
    );
  }),
).pipe(
  Command.withDescription(
    "Print an issue as it reads, its word counts and the rules it breaks. Reads no database.",
  ),
);

const approve = Command.make(
  "approve",
  {
    month: monthArgument,
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription(
        "Print the issue, every rule it breaks (its evenings and talks checked against the database) and its approval token; write nothing.",
      ),
      Flag.withDefault(false),
    ),
    approve: Flag.String("approve").pipe(
      Flag.withDescription(
        "The token --dry-run printed, on Erik's y for it: record his approval of exactly that issue, or refuse if it changed since.",
      ),
      Flag.optional,
    ),
  },
  (options) =>
    Effect.gen(function* () {
      if (options.dryRun === Option.isSome(options.approve)) {
        return yield* Effect.fail(
          new Error(
            "Give --dry-run to read the issue and its token, or --approve <token> to record Erik's y for exactly that.",
          ),
        );
      }
      const issue = yield* findIssue(options.month);
      const findings = [
        ...offlineFindings(issue),
        ...(yield* sourceFindings(issue)),
      ];
      const token = yield* issueToken(issue);
      if (Option.isNone(options.approve)) {
        yield* print(issue, findings);
        return yield* Console.log(
          findings.length === 0
            ? `Approval token: ${token}`
            : "No approval token until it breaks no rule.",
        );
      }
      if (findings.length > 0) {
        return yield* Effect.fail(
          new Error(
            `${options.month} breaks ${findings.length} rule(s): bun run letter approve ${options.month} --dry-run.`,
          ),
        );
      }
      if (token !== options.approve.value) {
        return yield* Effect.fail(
          new Error(
            `${options.month} changed since that token was printed: run --dry-run and read it again.`,
          ),
        );
      }
      const on = sfDay(yield* DateTime.now);
      const kept = approvals.filter((each) => each.month !== options.month);
      const next = [...kept, { month: options.month, on, token }].toSorted(
        (a, b) => a.month.localeCompare(b.month),
      );
      const file = new URL("../letters/approvals.json", import.meta.url);
      yield* Effect.promise(() =>
        Bun.write(file, `${JSON.stringify({ approvals: next }, null, 2)}\n`),
      );
      return yield* Console.log(
        `Approved ${options.month} on ${on}: commit core/letters/approvals.json to publish it.`,
      );
    }).pipe(Effect.provide(Database.scriptLayer)),
).pipe(
  Command.withDescription(
    "Check an issue against the database and print its approval token (--dry-run), or record Erik's y for exactly that version (--approve <token>).",
  ),
);

const letter = Command.make("letter").pipe(
  Command.withDescription(
    "The allthings letter: list its issues, show one, and record Erik's y.",
  ),
  Command.withSubcommands([list, show, approve]),
);

Command.run(letter, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
