import { resolve } from "node:path";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import {
  applyTalkArtifacts,
  decodeTalkArtifactsFile,
} from "../src/talk-artifacts.ts";

/**
 * Applies what talks left behind, their recordings, slides and code
 * (core/backfill/talk-artifacts.json, src/talk-artifacts.ts), to the
 * Postgres at DATABASE_URL, in one transaction.
 *
 *   bun run talk-artifacts [file] --dry-run   do everything, print it, roll back
 *   bun run talk-artifacts [file]             the same, committed
 *
 * DATABASE_URL comes from the environment only; .env files are not read.
 */

const command = Command.make(
  "talk-artifacts",
  {
    file: Argument.String("file").pipe(
      Argument.withDescription("The links, with their sources."),
      Argument.withDefault("backfill/talk-artifacts.json"),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Do everything, print it, then roll it back."),
      Flag.withDefault(false),
    ),
  },
  ({ file, dryRun }) =>
    Effect.gen(function* () {
      const text = yield* Effect.tryPromise({
        try: () => Bun.file(resolve(import.meta.dir, "..", file)).text(),
        catch: (cause) =>
          new Error(`Could not read ${file}: ${String(cause)}`, { cause }),
      });
      const artifacts = yield* decodeTalkArtifactsFile(text);
      const lines = yield* applyTalkArtifacts(artifacts, dryRun);
      yield* Console.log(lines.join("\n"));
    }).pipe(Effect.provide(Database.scriptLayer)),
).pipe(
  Command.withDescription(
    "Apply talks' recordings, slides and code from a sourced file.",
  ),
);

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
