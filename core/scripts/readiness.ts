import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer, Option } from "effect";
import { Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import { PlanningError } from "../src/planning/planning.ts";
import { formatReadiness } from "../src/readiness/format.ts";
import { type DraftRef, Readiness } from "../src/readiness/readiness.ts";

/**
 * How ready a draft evening is to go out, and what to add
 * (src/readiness/), for the Postgres at DATABASE_URL:
 *
 *   bun run readiness --event <slug>     a draft the Luma sync stored
 *   bun run readiness --idea <id>        an idea, through its draft evening if it has one
 *   bun run readiness --event <slug> --topic javascript --topic git   match more words
 *   … --json                             the report, for tools
 *
 * It only reads. As a role that may read planning (the studio, see core's
 * README, "The studio's connection") it also suggests planning's wanted
 * speakers and host prospects; as any other role it leaves them out and
 * says so. The collaboration's advice joins only as the owner, which row
 * security doesn't hold back; as the studio it is left out, and said so. It exits 1 when something blocks publishing. DATABASE_URL comes
 * from the environment only; .env files are not read.
 */

const command = Command.make(
  "readiness",
  {
    event: Flag.String("event").pipe(
      Flag.withDescription("The draft evening, by slug."),
      Flag.optional,
    ),
    idea: Flag.String("idea").pipe(
      Flag.withDescription("An idea from planning, by id."),
      Flag.optional,
    ),
    topic: Flag.String("topic").pipe(
      Flag.withDescription(
        "More words for the suggestions to match, beyond its topic; repeat for more.",
      ),
      Flag.atLeast(0),
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print the report as JSON."),
      Flag.withDefault(false),
    ),
  },
  ({ event, idea, topic, json }) =>
    Effect.gen(function* () {
      if (Option.isSome(event) === Option.isSome(idea)) {
        return yield* new PlanningError({
          reason: "Name one draft: --event <slug> or --idea <id>.",
        });
      }
      const draft: DraftRef = Option.isSome(event)
        ? { _tag: "Event", slug: event.value }
        : { _tag: "Idea", id: Option.getOrElse(idea, () => "") };
      const report = yield* Readiness.use((readiness) =>
        readiness.report(draft, { topics: topic }),
      );
      yield* Console.log(
        json ? JSON.stringify(report, null, 2) : formatReadiness(report),
      );
      if (!report.ready) process.exitCode = 1;
      return report.ready;
    }).pipe(
      Effect.provide(Readiness.layer.pipe(Layer.provide(Database.layer))),
    ),
).pipe(
  Command.withDescription(
    "Check a draft evening against the completeness rules ahead of time, and suggest speakers, hosts and dates.",
  ),
);

// A refusal is the answer, not a crash: its reason alone, on stderr, and exit 2
// (1 means the report ran and something blocks publishing).
Command.run(command, { version: "1.0.0" }).pipe(
  Effect.catchTag("PlanningError", (refusal) =>
    Effect.sync(() => {
      console.error(refusal.reason);
      process.exitCode = 2;
    }),
  ),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
