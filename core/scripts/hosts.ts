import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import { applyHostLinks, decodeHostLinksFile } from "../src/host-links.ts";

/**
 * Applies hosting companies' sourced websites and handles
 * (core/backfill/hosts.json, src/host-links.ts) to the Postgres at
 * DATABASE_URL, in one transaction.
 *
 *   bun run hosts [file] --dry-run   do everything, print it, roll back
 *   bun run hosts [file]             the same, committed
 *
 * DATABASE_URL comes from the environment only; .env files are not read.
 */

const command = Command.make(
  "hosts",
  {
    file: Argument.String("file").pipe(
      Argument.withDescription("The hosts' links, with their sources."),
      Argument.withDefault("backfill/hosts.json"),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Do everything, print it, then roll it back."),
      Flag.withDefault(false),
    ),
  },
  ({ file, dryRun }) =>
    Effect.gen(function* () {
      const text = yield* Effect.promise(() =>
        Bun.file(new URL(`../${file}`, import.meta.url)).text(),
      );
      const links = yield* decodeHostLinksFile(text);
      const lines = yield* applyHostLinks(links, dryRun);
      yield* Console.log(lines.join("\n"));
    }).pipe(Effect.provide(Database.layer)),
).pipe(Command.withDescription("Apply hosting companies' sourced links."));

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
