import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import { ShortSlugs, type SlugsResult } from "../src/slugs.ts";

/**
 * Gives every published evening without a short link its own, in the
 * Postgres at DATABASE_URL (src/slugs.ts, by the rule in
 * src/short-slugs.ts). The hourly sync does the same for new evenings
 * (web/src/sync/run.ts); this runs it now.
 *
 *   bun run slugs --dry-run   print the links it would give; write nothing
 *   bun run slugs             give them
 *
 * DATABASE_URL comes from the environment only; .env files are not read.
 */

const dryRunFlag = Flag.Boolean("dry-run").pipe(
  Flag.withDescription("Print the links without giving them."),
  Flag.withDefault(false),
);

const format = ({ given, written }: SlugsResult): string =>
  [
    written === null
      ? `Would give ${given.length} evening${given.length === 1 ? "" : "s"} a link (dry run: nothing written).`
      : `Gave ${written} evening${written === 1 ? "" : "s"} a link.`,
    ...given.map(({ slug, shortSlug }) => `  /${shortSlug}  ← /${slug}`),
  ].join("\n");

const command = Command.make("slugs", { dryRun: dryRunFlag }, ({ dryRun }) =>
  ShortSlugs.use((slugs) => slugs.assign({ dryRun })).pipe(
    Effect.flatMap((result) => Console.log(format(result))),
    Effect.provide(ShortSlugs.layer.pipe(Layer.provide(Database.layer))),
  ),
).pipe(Command.withDescription("Give each published evening its short link."));

Command.run(command, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
