import { BunRuntime, BunServices } from "@effect/platform-bun";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Console, DateTime, Effect, Layer, Option, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { SqlClient } from "effect/sql/SqlClient";
import { asOf } from "../src/clock.ts";
import { Argument, Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import { changeLines } from "../src/image-columns.ts";
import { speakersWithoutNow, staleRecords } from "../src/now-refresh.ts";
import { organizerCheckDays, staleHosts } from "../src/organizer-profiles.ts";
import { applyPeople, decodePeopleFile } from "../src/people-enrichment.ts";
import { formatJsonFile } from "../src/json-file.ts";
import { planProfilePhoto, setProfilePhoto } from "../src/profile-photo.ts";
import { orDataSourceError } from "../src/sql.ts";
import {
  duePosts,
  findCandidates,
  refreshPosts,
} from "../src/x-posts-refresh.ts";
import { XPostsSource } from "../src/x-posts-source.ts";
import { encode, placeholder } from "./encode.ts";
import { mediaOrigin, uploadMedia } from "./media.ts";
import { shellWord } from "./shell.ts";

/**
 * People's profiles, in the Postgres at DATABASE_URL.
 *
 *   bun run people [file] --dry-run   apply their sourced facts: do it, print it, roll back
 *   bun run people [file]             the same, committed
 *
 *   bun run people photo <profile> <file> --dry-run
 *   bun run people photo <profile> <file> --approve <token>
 *
 *   bun run people stale [--days 90] [--speakers] [--organizers] [--posts-days 30]
 *
 *   bun run people posts [file] --find [--only <name>] [--days 90] [--top 8]
 *   bun run people posts [file] --refresh [--days 0] [--dry-run]
 *
 * The facts are core/backfill/people.json (src/people-enrichment.ts):
 * titles, bios, links, photos and what each person does now (src/now.ts),
 * applied in one transaction. [file] is relative to core/, or absolute.
 *
 * stale prints, as JSON, the "now" records checked --days or more days
 * ago, for an agent to look at again (docs/now.md, "Refreshing").
 * --speakers adds everyone who has spoken at one of our evenings and has
 * never had one, which needs DATABASE_URL (site_reader's is enough).
 * --organizers adds, as `organizers`, everyone who organizes or co-hosts an
 * evening of ours not over yet whose title and bio the file hasn't both
 * read in the last 90 days (src/organizer-profiles.ts): what readiness
 * blocks a draft on. It reads DATABASE_URL too.
 *
 * stale also lists, as `posts`, the X posts (src/x-posts.ts) read
 * --posts-days (30) or more days ago: what `posts --refresh` is for.
 *
 * posts reads X with X_BEARER_TOKEN (1Password's "allthings X app",
 * "Bearer Token"; read only). --find prints, as JSON, each person's own
 * posts of the last --days days, ranked by how they were taken up, for
 * an agent to pick up to three that stand out for building software and
 * write them into the file as `xPosts`; it writes nothing, and reads the
 * profiles' X handles from DATABASE_URL (site_reader's is enough).
 * --refresh reads the counts of every post the file holds again (only
 * those read --days or more days ago), drops each one X no longer serves,
 * and writes the file; --dry-run prints what would change. --cache <dir>
 * keeps X's answers for the rest of their UTC day, so a rerun reads (and
 * is billed for) nothing twice.
 *
 * photo sets a profile's photo from a local file (src/profile-photo.ts).
 * <profile> is its id, its slug (as /people/<slug> has it) or its exact
 * name. The file is encoded as the photos are (upright, at most 4096
 * pixels, JPEG, or WebP where it is see-through, no metadata), stored
 * through the upload Worker under profiles/<name>-<id>, and recorded in
 * images. --dry-run encodes, reads and prints exactly what would change,
 * with its approval token, and stores and writes nothing. --approve <token>
 * makes exactly that change, or refuses it if anything changed since. A
 * photo it replaces loses its images row only when nothing else uses it;
 * its object stays in the bucket.
 *
 * DATABASE_URL (the studio's connection string for `photo`, profile_editor's
 * for applying the file: core's README, "Filling in profiles"), MEDIA_UPLOAD_URL
 * and MEDIA_UPLOAD_TOKEN (the upload Worker, for --approve) come from the
 * environment only; .env files are not read.
 */

/** core/, where a relative [file] starts. */
const coreDirectory = fileURLToPath(new URL("../", import.meta.url));

const fileArgument = Argument.String("file").pipe(
  Argument.withDescription(
    "The people's facts, with their sources: relative to core/, or absolute.",
  ),
  Argument.withDefault("backfill/people.json"),
);

/** The people file at `file`, decoded; a file that can't be read fails with its name. */
const readPeopleFile = (file: string) =>
  Effect.tryPromise({
    try: () => Bun.file(resolve(coreDirectory, file)).text(),
    catch: (cause) => new Error(`${file} could not be read: ${String(cause)}`),
  }).pipe(Effect.flatMap(decodePeopleFile));

const applyFacts = Command.make(
  "people",
  {
    file: fileArgument,
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Do everything, print it, then roll it back."),
      Flag.withDefault(false),
    ),
  },
  ({ file, dryRun }) =>
    Effect.gen(function* () {
      const links = yield* readPeopleFile(file);
      const lines = yield* applyPeople(links, dryRun);
      yield* Console.log(lines.join("\n"));
    }).pipe(Effect.provide(Database.scriptLayer)),
).pipe(
  Command.withDescription(
    "Fill people's profiles from sourced facts; a filled value is replaced only where the file names it as stale.",
  ),
);

const photo = Command.make(
  "photo",
  {
    profile: Argument.String("profile").pipe(
      Argument.withDescription(
        "The profile: its id, its slug, or its exact name.",
      ),
    ),
    file: Argument.String("file").pipe(Argument.withDescription("The photo.")),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription(
        "Print exactly what would change, and its approval token; store and write nothing.",
      ),
      Flag.withDefault(false),
    ),
    approve: Flag.String("approve").pipe(
      Flag.withDescription(
        "The token --dry-run printed: make exactly that change, or refuse if anything changed since.",
      ),
      Flag.optional,
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print the result as JSON."),
      Flag.withDefault(false),
    ),
  },
  ({ profile, file, dryRun, approve, json }) =>
    Effect.gen(function* () {
      // Exactly one: read what would change, or make the change approved.
      if (dryRun === Option.isSome(approve)) {
        return yield* Effect.fail(
          new Error(
            "Give --dry-run to read what would change, or --approve <token> to make exactly that change.",
          ),
        );
      }
      const image = {
        name: basename(file),
        bytes: yield* Effect.tryPromise({
          try: () => Bun.file(file).bytes(),
          catch: (cause) =>
            new Error(`${file} could not be read: ${String(cause)}`),
        }),
      };
      if (Option.isNone(approve)) {
        const { change, token } = yield* planProfilePhoto(profile, image, {
          encode,
          placeholder,
          origin: mediaOrigin,
        });
        return yield* Console.log(
          json
            ? JSON.stringify({ dryRun: true, change, token }, null, 2)
            : [
                `${change.row.name} (${change.row.id}): their photo`,
                ...changeLines(change, false),
                `approval token: ${token}`,
                `Nothing was stored or changed. To make exactly this change: bun run people photo ${shellWord(profile)} ${shellWord(file)} --approve ${token}`,
              ].join("\n"),
        );
      }
      const change = yield* setProfilePhoto(profile, image, approve.value, {
        media: yield* uploadMedia,
        encode,
        placeholder,
        origin: mediaOrigin,
      });
      return yield* Console.log(
        json
          ? JSON.stringify({ dryRun: false, change }, null, 2)
          : [
              `Set ${change.row.name}'s photo (${change.row.id}).`,
              ...changeLines(change, true),
            ].join("\n"),
      );
    }).pipe(Effect.provide(Database.scriptLayer)),
).pipe(
  Command.withDescription(
    "Set a profile's photo from a file, exactly as a dry run showed it.",
  ),
);

const stale = Command.make(
  "stale",
  {
    file: fileArgument,
    days: Flag.Int("days").pipe(
      Flag.withDescription("List records checked this many days ago or more."),
      Flag.withDefault(90),
    ),
    speakers: Flag.Boolean("speakers").pipe(
      Flag.withDescription(
        "Add everyone who has spoken at one of our evenings and never had a record (reads DATABASE_URL).",
      ),
      Flag.withDefault(false),
    ),
    postsDays: Flag.Int("posts-days").pipe(
      Flag.withDescription("List X posts read this many days ago or more."),
      Flag.withDefault(30),
    ),
    organizers: Flag.Boolean("organizers").pipe(
      Flag.withDescription(
        `Add the organizers and co-hosts of evenings ahead whose title and bio weren't both checked in ${organizerCheckDays} days (reads DATABASE_URL).`,
      ),
      Flag.withDefault(false),
    ),
  },
  ({ file, days, speakers, organizers, postsDays }) =>
    Effect.gen(function* () {
      if (days < 0) {
        return yield* Effect.fail(new Error("--days can't be negative."));
      }
      const people = yield* readPeopleFile(file);
      const today = DateTime.formatIsoDateUtc(yield* asOf);
      const due = [
        ...staleRecords(people, today, days),
        ...(speakers
          ? yield* speakersWithoutNow(people).pipe(
              Effect.provide(Database.scriptLayer),
            )
          : []),
      ];
      const hosts = organizers
        ? yield* staleHosts(people, organizerCheckDays, today).pipe(
            // Judged on the `today` printed here: one reading of the clock.
            Effect.map((checked) => ({ organizers: checked.hosts })),
            Effect.provide(Database.scriptLayer),
          )
        : {};
      const posts = duePosts(people, today, postsDays);
      return yield* Console.log(
        JSON.stringify({ today, days, due, posts, ...hosts }, null, 2),
      );
    }),
).pipe(
  Command.withDescription(
    'List, as JSON, the "now" records due for another look, and with --speakers the speakers who never had one.',
  ),
);

const Poster = Schema.Struct({
  profileId: Schema.String,
  name: Schema.String,
  handle: Schema.String,
  userId: Schema.NullOr(Schema.String),
});

/** The X handle and user id of each profile in `ids` that has a handle. */
const postersOf = (ids: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    return yield* sql`
      SELECT id::text AS "profileId", name,
        ltrim(btrim(twitter_handle), '@') AS handle, x_user_id AS "userId"
      FROM profiles
      WHERE id::text IN ${sql.in(ids)} AND btrim(coalesce(twitter_handle, '')) <> ''
      ORDER BY name`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Poster))),
      orDataSourceError,
    );
  });

const posts = Command.make(
  "posts",
  {
    file: fileArgument,
    find: Flag.Boolean("find").pipe(
      Flag.withDescription(
        "Print each person's own recent posts, ranked, as JSON, to pick from; write nothing.",
      ),
      Flag.withDefault(false),
    ),
    refresh: Flag.Boolean("refresh").pipe(
      Flag.withDescription(
        "Read the counts of the file's posts again, drop those X no longer serves, and write the file.",
      ),
      Flag.withDefault(false),
    ),
    only: Flag.String("only").pipe(
      Flag.withDescription("Only this person, by their exact name (--find)."),
      Flag.optional,
    ),
    days: Flag.Int("days").pipe(
      Flag.withDescription(
        "--find: posts of the last this many days (90). --refresh: only records read this many days ago or more (0: all).",
      ),
      Flag.optional,
    ),
    top: Flag.Int("top").pipe(
      Flag.withDescription("--find: list this many of each person's posts."),
      Flag.withDefault(8),
    ),
    read: Flag.Int("read").pipe(
      Flag.withDescription(
        "--find: read at most this many of each person's posts (X bills each).",
      ),
      Flag.withDefault(100),
    ),
    cache: Flag.String("cache").pipe(
      Flag.withDescription(
        "Keep X's answers in this directory for the rest of their UTC day.",
      ),
      Flag.optional,
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription(
        "--refresh: print what would change; write nothing.",
      ),
      Flag.withDefault(false),
    ),
  },
  ({ file, find, refresh, only, days, top, read, cache, dryRun }) =>
    Effect.gen(function* () {
      if (find === refresh) {
        return yield* Effect.fail(
          new Error(
            "Give --find to list posts to pick from, or --refresh to read the file's again.",
          ),
        );
      }
      const people = yield* readPeopleFile(file);
      const today = DateTime.formatIsoDateUtc(yield* asOf);
      const source = XPostsSource.xApi(
        Option.match(cache, {
          onNone: () => undefined,
          onSome: (directory) => ({ directory, day: today }),
        }),
      ).pipe(Layer.provide(FetchHttpClient.layer));
      if (find) {
        if (top < 1 || read < 1) {
          return yield* Effect.fail(
            new Error("--top and --read must be at least 1."),
          );
        }
        if (Option.getOrElse(days, () => 90) < 0) {
          return yield* Effect.fail(new Error("--days can't be negative."));
        }
        const named = Option.match(only, {
          onNone: () => people,
          onSome: (name) => people.filter((entry) => entry.name === name),
        });
        if (named.length === 0) {
          return yield* Effect.fail(
            new Error(
              `No one in ${file} is named ${Option.getOrElse(only, () => "")}.`,
            ),
          );
        }
        const posters = yield* postersOf(
          named.map((entry) => entry.profileId),
        ).pipe(Effect.provide(Database.scriptLayer));
        const found = yield* findCandidates(posters, {
          today,
          days: Option.getOrElse(days, () => 90),
          top,
          read,
        }).pipe(Effect.provide(source));
        return yield* Console.log(JSON.stringify({ today, found }, null, 2));
      }
      const refreshed = yield* refreshPosts(
        people,
        today,
        Option.getOrElse(days, () => 0),
      ).pipe(Effect.provide(source));
      if (!dryRun) {
        yield* Effect.promise(() =>
          Bun.write(
            resolve(coreDirectory, file),
            formatJsonFile(refreshed.file),
          ),
        );
      }
      return yield* Console.log(
        [
          ...refreshed.lines,
          dryRun
            ? "Dry run: the file is unchanged."
            : `Wrote ${file}; apply it with bun run people.`,
        ].join("\n"),
      );
    }),
).pipe(
  Command.withDescription(
    "Find people's standout posts on X to pick from, or read the counts of the file's posts again.",
  ),
);

Command.run(applyFacts.pipe(Command.withSubcommands([photo, stale, posts])), {
  version: "1.0.0",
}).pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
