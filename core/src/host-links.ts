import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { HttpUrl } from "./contract.ts";
import { DataSourceError } from "./errors.ts";

/**
 * Hosting companies' own websites and X, Bluesky and LinkedIn handles,
 * researched from their official sites and profiles (core/backfill/hosts.json)
 * and written to `sponsors` in one transaction. Every fact carries the
 * source it was read from; a fact that could not be confirmed is left out,
 * or kept under `held` with its reason, and never written.
 *
 * Applying is safe to repeat: each fact is set where it differs, and a
 * column the file says nothing about is left as it is. A dry run does all
 * of it, reports, and rolls back.
 */

/** An https URL with a domain-name host, as the public contract accepts, and no whitespace. */
const Url = HttpUrl.check(Schema.isPattern(/^https:\/\/\S+$/));

/** A value with where it was read. Each pattern is the column's CHECK (migrations/0006_host_links.ts). */
const fact = <S extends Schema.Top>(value: S) =>
  Schema.Struct({ value, source: Url });

export const websitePattern = /^https:\/\/[A-Za-z0-9.-]+(\/\S*)?$/;
export const xHandlePattern = /^[A-Za-z0-9_]{1,15}$/;
export const blueskyHandlePattern =
  /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
export const linkedinHandlePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

export const HostLinksEntry = Schema.Struct({
  /** The host's name as stored (`sponsors.name`, unique). */
  name: Schema.String.check(Schema.isNonEmpty()),
  website: Schema.optionalKey(
    fact(Url.check(Schema.isPattern(websitePattern))),
  ),
  twitterHandle: Schema.optionalKey(
    fact(Schema.String.check(Schema.isPattern(xHandlePattern))),
  ),
  blueskyHandle: Schema.optionalKey(
    fact(Schema.String.check(Schema.isPattern(blueskyHandlePattern))),
  ),
  linkedinHandle: Schema.optionalKey(
    fact(Schema.String.check(Schema.isPattern(linkedinHandlePattern))),
  ),
  /** Facts found but not confirmed well enough to write, each with why. */
  held: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        field: Schema.Literals([
          "website",
          "twitterHandle",
          "blueskyHandle",
          "linkedinHandle",
        ]),
        value: Schema.String,
        sources: Schema.Array(Url),
        reason: Schema.String.check(Schema.isNonEmpty()),
      }),
    ),
  ),
});
export type HostLinksEntry = typeof HostLinksEntry.Type;

export const HostLinksFile = Schema.Array(HostLinksEntry);
export type HostLinksFile = typeof HostLinksFile.Type;

/** A file that cannot be applied as written; nothing was written. */
export class HostLinksError extends Schema.TaggedError<HostLinksError>()(
  "HostLinksError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

class RolledBack extends Schema.TaggedError<RolledBack>()("RolledBack", {
  lines: Schema.Array(Schema.String),
}) {}

const HostRow = Schema.Struct({
  id: Schema.String,
  website_url: Schema.NullOr(Schema.String),
  twitter_handle: Schema.NullOr(Schema.String),
  bluesky_handle: Schema.NullOr(Schema.String),
  linkedin_handle: Schema.NullOr(Schema.String),
});

const columns = [
  ["website", "website_url"],
  ["twitterHandle", "twitter_handle"],
  ["blueskyHandle", "bluesky_handle"],
  ["linkedinHandle", "linkedin_handle"],
] as const;

/**
 * Writes `file` in one transaction; with `dryRun`, rolls it back after
 * doing everything. Fails, writing nothing, on a host name that is not
 * stored or is listed twice.
 */
export const applyHostLinks = (file: HostLinksFile, dryRun: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const names = file.map((entry) => entry.name);
    const twice = names.filter((name, index) => names.indexOf(name) !== index);
    if (twice.length > 0) {
      return yield* new HostLinksError({
        reason: `Hosts listed more than once: ${[...new Set(twice)].join(", ")}`,
      });
    }

    const heldAndSet = file.flatMap((entry) =>
      (entry.held ?? [])
        .filter((held) => entry[held.field] !== undefined)
        .map((held) => `${entry.name} ${held.field}`),
    );
    if (heldAndSet.length > 0) {
      return yield* new HostLinksError({
        reason: `Facts both held and set (drop one): ${heldAndSet.join(", ")}`,
      });
    }

    const work = Effect.gen(function* () {
      const lines: Array<string> = [];
      for (const entry of file) {
        const rows = yield* sql`
          SELECT id, website_url, twitter_handle, bluesky_handle, linkedin_handle
          FROM sponsors WHERE name = ${entry.name}
          FOR UPDATE`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(HostRow))),
        );
        const [row] = rows;
        if (row === undefined) {
          return yield* new HostLinksError({
            reason: `No hosting company is stored as "${entry.name}".`,
          });
        }
        const changes = columns.flatMap(([field, column]) => {
          const value = entry[field]?.value;
          return value === undefined || value === row[column]
            ? []
            : [`${column} ${row[column] ?? "∅"} → ${value}`];
        });
        for (const held of entry.held ?? []) {
          lines.push(
            `held: ${entry.name} ${held.field} ${held.value}: ${held.reason}`,
          );
        }
        if (changes.length === 0) {
          lines.push(`${entry.name}: unchanged`);
          continue;
        }
        yield* sql`
          UPDATE sponsors SET
            website_url = COALESCE(${entry.website?.value ?? null}, website_url),
            twitter_handle = COALESCE(${entry.twitterHandle?.value ?? null}, twitter_handle),
            bluesky_handle = COALESCE(${entry.blueskyHandle?.value ?? null}, bluesky_handle),
            linkedin_handle = COALESCE(${entry.linkedinHandle?.value ?? null}, linkedin_handle),
            updated_at = now()
          WHERE id = ${row.id}`;
        lines.push(`${entry.name}: ${changes.join(", ")}`);
      }
      if (dryRun) return yield* new RolledBack({ lines });
      return lines;
    });

    return yield* sql.withTransaction(work).pipe(
      Effect.catchTag("RolledBack", (rolledBack) =>
        Effect.succeed([...rolledBack.lines, "Dry run: rolled back."]),
      ),
      Effect.catchTag(["SqlError", "SchemaError"], (cause) =>
        Effect.fail(new DataSourceError({ cause })),
      ),
    );
  });
