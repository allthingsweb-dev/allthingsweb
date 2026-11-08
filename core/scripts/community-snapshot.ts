import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import {
  CommunitySources,
  needsAction,
  snapshotCommunity,
  type Source,
  sources,
} from "../src/community-metrics.ts";
import * as Database from "../src/database.ts";

/**
 * Takes today's community snapshot (src/community-metrics.ts) of the
 * sources named, as the sync Worker takes it of all of them: each source
 * the day has no number for yet is read and stored, never replacing one,
 * and a gap is recorded. It fails only on what someone has to act on
 * (`needsAction`), as the sync's step does.
 *
 * GitHub Actions runs it for GitHub (.github/workflows/community.yaml) as
 * site_sync (NEON_SYNC_URL), with its built-in GITHUB_TOKEN: GitHub then
 * counts the read against that token, not against Cloudflare's shared
 * address, whose hourly allowance others use up.
 *
 *   bun run community-snapshot --only github --dry-run   read, write nothing
 *   bun run community-snapshot --only github             read and store
 *
 * DATABASE_URL comes from the environment only; .env files are not read.
 */

const isSource = (name: string): name is Source =>
  (sources as ReadonlyArray<string>).includes(name);

const command = Command.make(
  "community-snapshot",
  {
    only: Flag.String("only").pipe(
      Flag.withDescription(
        `The sources to snapshot, comma-separated: ${sources.join(", ")}.`,
      ),
      Flag.filter(
        (only) => only.split(",").every(isSource),
        (only) => `--only takes ${sources.join(", ")}, not ${only}`,
      ),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Read the sources and print them; write nothing."),
      Flag.withDefault(false),
    ),
  },
  ({ only, dryRun }) =>
    Effect.gen(function* () {
      const report = yield* snapshotCommunity({
        dryRun,
        only: only.split(",").filter(isSource),
      });
      yield* Console.log(JSON.stringify(report));
      const action = needsAction(report);
      if (action !== undefined) yield* Effect.fail(new Error(action));
    }).pipe(
      Effect.provide(
        CommunitySources.live.pipe(
          Layer.provideMerge(
            Layer.mergeAll(FetchHttpClient.layer, Database.scriptLayer),
          ),
        ),
      ),
    ),
).pipe(
  Command.withDescription(
    "Snapshot the community's numbers from the sources named.",
  ),
);

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
