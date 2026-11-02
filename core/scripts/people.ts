import { BunRuntime, BunServices } from "@effect/platform-bun";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Console, DateTime, Effect, Option } from "effect";
import { asOf } from "../src/clock.ts";
import { Argument, Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import { changeLines } from "../src/image-columns.ts";
import { speakersWithoutNow, staleRecords } from "../src/now-refresh.ts";
import { applyPeople, decodePeopleFile } from "../src/people-enrichment.ts";
import { planProfilePhoto, setProfilePhoto } from "../src/profile-photo.ts";
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
 *   bun run people stale [--days 90] [--speakers]
 *
 * The facts are core/backfill/people.json (src/people-enrichment.ts):
 * titles, bios, links, photos and what each person does now (src/now.ts),
 * applied in one transaction. [file] is relative to core/, or absolute.
 *
 * stale prints, as JSON, the "now" records checked --days or more days
 * ago, for an agent to look at again (docs/now.md, "Refreshing").
 * --speakers adds everyone who has spoken at one of our evenings and has
 * never had one, which needs DATABASE_URL (site_reader's is enough).
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
 * DATABASE_URL (the studio's connection string for `photo`, the owner's
 * for applying the file: core's README, "The studio's connection"), MEDIA_UPLOAD_URL
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
  },
  ({ file, days, speakers }) =>
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
      return yield* Console.log(JSON.stringify({ today, days, due }, null, 2));
    }),
).pipe(
  Command.withDescription(
    'List, as JSON, the "now" records due for another look, and with --speakers the speakers who never had one.',
  ),
);

Command.run(applyFacts.pipe(Command.withSubcommands([photo, stale])), {
  version: "1.0.0",
}).pipe(Effect.provide(BunServices.layer), BunRuntime.runMain);
