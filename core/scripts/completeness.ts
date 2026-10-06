import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, DateTime, Duration, Effect, Layer } from "effect";
import { Command, Flag } from "effect/cli";
import {
  Completeness,
  mustHaveTalks,
  mustHaveVenues,
  recentWindow,
} from "../src/completeness.ts";
import { formatReport, reportJson } from "../src/completeness-report.ts";
import * as Database from "../src/database.ts";

/**
 * Prints what each published event's record lacks (src/completeness.ts),
 * reading the Postgres at DATABASE_URL. It only reads: production's
 * read-only site_reader role is enough.
 *
 *   bun run completeness           a table of every event, then each one's gaps
 *   bun run completeness --json    the same as JSON
 *   bun run completeness --check   also fail if an evening of talks that
 *                                  ended in the last 30 days (--within)
 *                                  has none, or any published evening,
 *                                  past or upcoming, has no venue
 *
 * DATABASE_URL comes from the environment only; .env files are not read:
 *
 *   DATABASE_URL=$(op read "op://Private/allthings site_reader/credential") \
 *     bun run completeness
 */

const jsonFlag = Flag.Boolean("json").pipe(
  Flag.withDescription("Print the report as JSON."),
  Flag.withDefault(false),
);

const checkFlag = Flag.Boolean("check").pipe(
  Flag.withDescription(
    "Fail if an evening of talks that ended recently has none (see --within), or any evening has no venue.",
  ),
  Flag.withDefault(false),
);

const withinFlag = Flag.Int("within").pipe(
  Flag.withDescription("Days --check looks back, at least 1."),
  // Zero or fewer days would look back at nothing, and always pass.
  Flag.filter(
    (days) => days >= 1,
    (days) => `--within must be at least 1 day, not ${days}`,
  ),
  Flag.withDefault(Duration.toDays(recentWindow)),
);

const command = Command.make(
  "completeness",
  { json: jsonFlag, check: checkFlag, within: withinFlag },
  ({ json, check, within }) =>
    Effect.gen(function* () {
      const reports = yield* Completeness.use((c) => c.report);
      yield* Console.log(
        json
          ? JSON.stringify(reportJson(reports), null, 2)
          : formatReport(reports),
      );
      if (!check) return;
      const withoutTalks = mustHaveTalks(
        reports,
        yield* DateTime.now,
        Duration.days(within),
      );
      const withoutVenues = mustHaveVenues(reports);
      const failures = [
        ...(withoutTalks.length === 0
          ? []
          : [
              `Evenings of talks that ended in the last ${within} days without any: ${withoutTalks.map((r) => r.slug).join(", ")}`,
            ]),
        ...(withoutVenues.length === 0
          ? []
          : [
              `Evenings without a venue: ${withoutVenues.map((r) => r.slug).join(", ")}`,
            ]),
      ];
      if (failures.length > 0) {
        yield* Effect.fail(new Error(failures.join("\n")));
      }
    }).pipe(
      Effect.provide(Completeness.layer.pipe(Layer.provide(Database.layer))),
    ),
).pipe(
  Command.withDescription("Report what each published event's record lacks."),
);

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
