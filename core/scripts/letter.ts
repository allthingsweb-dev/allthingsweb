import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, DateTime, Effect } from "effect";
import { Argument, Command } from "effect/cli";
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
  letterWords,
  plainText,
  proseParts,
  repeatsOfEdits,
  sectionOrder,
  sectionTitles,
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
 *   bun run letter approve <yyyy-mm> <token>
 *
 * list prints every issue, with whether it is a draft or approved. show
 * prints one as it reads, its words against each budget, every rule it
 * breaks, Erik's edits to it so far, and its approval token. approve
 * records Erik's y in core/letters/approvals.json, for the token show
 * printed: if the issue changed since, the token doesn't match and nothing
 * is written. Run approve only on Erik's own y for that token.
 *
 * Nothing here reaches a database or sends anything.
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

const show = Command.make("show", { month: monthArgument }, ({ month }) =>
  Effect.gen(function* () {
    const issue = yield* findIssue(month);
    yield* Console.log(reading(issue));
    const findings = [...letterFindings(issue), ...repeatsOfEdits(issue)];
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
    const edits = editsOf(month);
    yield* Console.log(
      `Erik's edits so far: ${edits.cut} cut, ${edits.reword} reworded, ${edits.fact} on facts.`,
    );
    yield* Console.log(`It's ${yield* stateOf(issue)}.`);
    yield* Console.log(`Approval token: ${yield* issueToken(issue)}`);
    // Every link it makes, so a reader can open each before saying y.
    const links = [
      ...itemsOf(issue).flatMap(({ item }) => [
        sourceUrl(item.source),
        ...hrefs(item.text),
      ]),
      ...(issue.closing === undefined ? [] : hrefs(issue.closing)),
    ];
    yield* Console.log(["Links:", ...new Set(links)].join("\n  "));
  }),
).pipe(
  Command.withDescription(
    "Print an issue as it reads, its word counts, the rules it breaks and its approval token.",
  ),
);

const approve = Command.make(
  "approve",
  {
    month: monthArgument,
    token: Argument.String("token").pipe(
      Argument.withDescription("The approval token show printed."),
    ),
  },
  ({ month, token }) =>
    Effect.gen(function* () {
      const issue = yield* findIssue(month);
      const findings = [...letterFindings(issue), ...repeatsOfEdits(issue)];
      if (findings.length > 0) {
        yield* Effect.fail(
          new Error(
            `${month} breaks ${findings.length} rule(s): bun run letter show ${month}.`,
          ),
        );
      }
      if ((yield* issueToken(issue)) !== token) {
        yield* Effect.fail(
          new Error(
            `${month} changed since that token was printed: show it again and read it again.`,
          ),
        );
      }
      const on = sfDay(yield* DateTime.now);
      const kept = approvals.filter((each) => each.month !== month);
      const next = [...kept, { month, on, token }].toSorted((a, b) =>
        a.month.localeCompare(b.month),
      );
      const file = new URL("../letters/approvals.json", import.meta.url);
      yield* Effect.promise(() =>
        Bun.write(file, `${JSON.stringify({ approvals: next }, null, 2)}\n`),
      );
      yield* Console.log(
        `Approved ${month} on ${on}: commit core/letters/approvals.json to publish it.`,
      );
    }),
).pipe(
  Command.withDescription(
    "Record Erik's y on an issue, for exactly the version its token names.",
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
