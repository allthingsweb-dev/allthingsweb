import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer } from "effect";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as Database from "../src/database.ts";
import { Luma } from "../src/luma/luma.ts";
import { LumaSync, type SyncRehearsal } from "../src/luma/sync.ts";

/**
 * The hourly event sync's dry run (`LumaSync.rehearse`): reads Luma's
 * calendar and the Postgres at DATABASE_URL, runs the sync's statement in a
 * transaction that rolls back, and prints what it would write. Nothing is
 * committed. Writing is the sync Worker's job, so this script never writes.
 *
 *   bun run sync:rehearse          each event it would create or change
 *   bun run sync:rehearse --json   the same, as JSON
 *
 * DATABASE_URL comes from the environment only; .env files are not read. Use
 * the role the sync writes as, so the rehearsal also proves its grants, and
 * pass it without printing it:
 *
 *   DATABASE_URL=$(op read "op://allthings/allthings site_sync/credential") \
 *     bun run sync:rehearse
 */

const jsonFlag = Flag.Boolean("json").pipe(
  Flag.withDescription("Print the rehearsal as JSON."),
  Flag.withDefault(false),
);

const show = (value: unknown) =>
  typeof value === "string" ? JSON.stringify(value) : String(value);

/** The rehearsal as lines a person reads. */
export function formatRehearsal(rehearsal: SyncRehearsal): string {
  const lines = [
    `${rehearsal.syncedCount} events in Luma's feed (${rehearsal.publishedCount} published): would create ${rehearsal.created.length} and update ${rehearsal.updated.length}; ${rehearsal.syncedCount - rehearsal.changedCount} already match.`,
  ];
  for (const event of rehearsal.created) {
    lines.push(`+ ${event.slug} ${show(event.fields["name"])}`);
  }
  for (const event of rehearsal.updated) {
    lines.push(`~ ${event.slug}`);
    for (const [column, { before, after }] of Object.entries(event.changes)) {
      lines.push(`    ${column}: ${show(before)} → ${show(after)}`);
    }
  }
  return lines.join("\n");
}

const command = Command.make("sync-rehearsal", { json: jsonFlag }, ({ json }) =>
  LumaSync.use((sync) => sync.rehearse).pipe(
    Effect.flatMap((rehearsal) =>
      Console.log(
        json ? JSON.stringify(rehearsal, null, 2) : formatRehearsal(rehearsal),
      ),
    ),
    Effect.provide(
      LumaSync.layer.pipe(
        Layer.provide(Luma.layer),
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(Database.layer),
      ),
    ),
  ),
).pipe(
  Command.withDescription(
    "Show what the hourly Luma sync would write, without writing it.",
  ),
);

if (import.meta.main) {
  Command.run(command, { version: "1.0.0" }).pipe(
    Effect.provide(BunServices.layer),
    BunRuntime.runMain,
  );
}
