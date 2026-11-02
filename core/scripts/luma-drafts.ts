import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as Database from "../src/database.ts";
import type { DataSourceError } from "../src/errors.ts";
import { LumaApi, type LumaApiError } from "../src/luma/api.ts";
import {
  DraftNotAdded,
  DraftNotForgotten,
  formatAdded,
  formatDrafts,
  formatForgotten,
  LumaDrafts,
} from "../src/luma/drafts.ts";

/**
 * Refreshes every draft we know from Luma's API (src/luma/drafts.ts): the
 * calendar feed carries no private event, so a draft's name, times and
 * venue go stale without it. Read-only on Luma. The hourly sync does the
 * same (web/src/sync/run.ts); this runs it now.
 *
 *   bun run luma:drafts --dry-run   ask Luma and print what would change; write nothing
 *   bun run luma:drafts             the same, then write it
 *   bun run luma:drafts --add evt-… --dry-run   what storing a private event as a draft would write
 *   bun run luma:drafts --add evt-…             store it: the feed never carries it
 *   bun run luma:drafts --forget <slug or evt-…> --dry-run   what forgetting a draft Luma deleted would remove
 *   bun run luma:drafts --forget <slug or evt-…>             remove it, once Luma confirms its event is gone
 *
 * DATABASE_URL and LUMA_API_KEY come from the environment only; .env files
 * are not read. Without LUMA_API_KEY it says so and does nothing.
 */

const dryRunFlag = Flag.Boolean("dry-run").pipe(
  Flag.withDescription("Print what would be written without writing it."),
  Flag.withDefault(false),
);

const addFlag = Flag.String("add").pipe(
  Flag.withDescription(
    "Store this private Luma event (evt-…) as a draft evening, as the studio's new evenings need: the feed never carries a private event.",
  ),
  Flag.optional,
);

const forgetFlag = Flag.String("forget").pipe(
  Flag.withDescription(
    "Remove this stored draft (its slug, or its Luma evt-…) once Luma confirms its event is gone (403 or 404), with its private lineup and talks; its log and notes stay. Refused while anything public, an idea or a collaboration points at it.",
  ),
  Flag.optional,
);

/** What the flags ask for, as the organizer reads it. */
const work = (
  dryRun: boolean,
  add: Option.Option<string>,
  forget: Option.Option<string>,
): Effect.Effect<
  void,
  DraftNotAdded | DraftNotForgotten | LumaApiError | DataSourceError,
  LumaDrafts
> => {
  if (Option.isSome(add) && Option.isSome(forget)) {
    return Effect.fail(
      new DraftNotAdded({
        reason: "Pass --add or --forget, not both: nothing was written.",
      }),
    );
  }
  if (Option.isSome(add)) {
    return LumaDrafts.use((drafts) => drafts.add(add.value, { dryRun })).pipe(
      Effect.flatMap((added) => Console.log(formatAdded(added))),
    );
  }
  if (Option.isSome(forget)) {
    return LumaDrafts.use((drafts) =>
      drafts.forget(forget.value, { dryRun }),
    ).pipe(
      Effect.flatMap((forgotten) => Console.log(formatForgotten(forgotten))),
    );
  }
  return LumaDrafts.use((drafts) => drafts.run({ dryRun })).pipe(
    Effect.flatMap((result) => Console.log(formatDrafts(result))),
  );
};

const command = Command.make(
  "luma-drafts",
  { dryRun: dryRunFlag, add: addFlag, forget: forgetFlag },
  ({ dryRun, add, forget }) =>
    work(dryRun, add, forget).pipe(
      Effect.provide(
        LumaDrafts.layer.pipe(
          Layer.provide(LumaApi.layer),
          Layer.provide(FetchHttpClient.layer),
          Layer.provide(Database.scriptLayer),
        ),
      ),
    ),
).pipe(
  Command.withDescription(
    "Refresh each draft's name, times and venue from Luma's API; with --add, store a private Luma event as a draft; with --forget, remove a draft whose Luma event is gone.",
  ),
);

// A refusal is the answer, not a crash: its reason alone, on stderr, and exit 1.
Command.run(command, { version: "1.0.0" }).pipe(
  Effect.catchTag(["DraftNotAdded", "DraftNotForgotten"], (refusal) =>
    Effect.sync(() => {
      console.error(refusal.reason);
      process.exitCode = 1;
    }),
  ),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
