import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import {
  changeLines,
  changesAnything,
  editTalk,
  listTalks,
  planTalkEdit,
  type SpeakerRole,
  type TalkEdit,
} from "../src/talk-edits.ts";
import { shellWord } from "./shell.ts";

/**
 * Talks, in the Postgres at DATABASE_URL (src/talk-edits.ts).
 *
 *   bun run talks list <event slug> [--json]
 *   bun run talks update <talk id> [--title "…"] [--description "…" | --description-file <file>]
 *     [--speaker <profile>[:moderator]]… --dry-run [--json]
 *   bun run talks update <talk id> … (the same) --approve <token> [--json]
 *
 * list prints an evening's talks in page order, with their ids, formats and
 * speakers. It only reads.
 *
 * update edits a talk that exists: its title, its description (editor
 * HTML, as the site stores it) and its speakers. What it isn't given stays
 * as it is. --speaker, once per speaker in the order the page should show
 * them, names a profile by its slug (as /people/<slug> has it) or its id,
 * with ":moderator" for a moderator; the list given replaces the talk's
 * whole list. --dry-run prints each value as it is and as it will be, as a
 * diff, and its approval token, and changes nothing. --approve <token>,
 * with the same values, makes exactly that change, or refuses it if
 * anything changed since.
 *
 * DATABASE_URL (the owner's connection string, to write) comes from the
 * environment only; .env files are not read.
 */

const jsonFlag = Flag.Boolean("json").pipe(
  Flag.withDescription("Print the result as JSON."),
  Flag.withDefault(false),
);

const list = Command.make(
  "list",
  {
    slug: Argument.String("slug").pipe(
      Argument.withDescription("The evening's slug or short link."),
    ),
    json: jsonFlag,
  },
  ({ slug, json }) =>
    Effect.gen(function* () {
      const listed = yield* listTalks(slug);
      yield* Console.log(
        json
          ? JSON.stringify(listed, null, 2)
          : [
              `${listed.slug}: ${listed.talks.length} talk${listed.talks.length === 1 ? "" : "s"}`,
              ...listed.talks.flatMap((talk, index) => [
                `${index + 1}. ${talk.id} (${talk.format}) ${JSON.stringify(talk.title)}`,
                ...talk.speakers.map(
                  (speaker) =>
                    `   ${speaker.name} (${speaker.slug}, ${speaker.role})`,
                ),
              ]),
            ].join("\n"),
      );
    }).pipe(Effect.provide(Database.layer)),
).pipe(
  Command.withDescription(
    "List an evening's talks with their ids and speakers. Reads only.",
  ),
);

/** "ada-lovelace" is a speaker; "ada-lovelace:moderator" a moderator. */
const speakerOf = (text: string) => {
  const match = /^(.+?)(?::(speaker|moderator))?$/.exec(text);
  return {
    profile: match?.[1] ?? text,
    role: (match?.[2] ?? "speaker") as SpeakerRole,
  };
};

const update = Command.make(
  "update",
  {
    talk: Argument.String("talk").pipe(
      Argument.withDescription("The talk's id (talks list shows it)."),
    ),
    title: Flag.String("title").pipe(
      Flag.withDescription("The new title."),
      Flag.optional,
    ),
    description: Flag.String("description").pipe(
      Flag.withDescription("The new description, as editor HTML."),
      Flag.optional,
    ),
    descriptionFile: Flag.String("description-file").pipe(
      Flag.withDescription("A file holding the new description."),
      Flag.optional,
    ),
    speaker: Flag.String("speaker").pipe(
      Flag.withDescription(
        "A speaker, by profile slug or id, with :moderator for a moderator; once each, in page order. The list replaces the talk's.",
      ),
      Flag.atLeast(0),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription(
        "Print exactly what would change, as a diff, and its approval token; change nothing.",
      ),
      Flag.withDefault(false),
    ),
    approve: Flag.String("approve").pipe(
      Flag.withDescription(
        "The token --dry-run printed: make exactly that change, or refuse if anything changed since.",
      ),
      Flag.optional,
    ),
    json: jsonFlag,
  },
  (options) =>
    Effect.gen(function* () {
      // Exactly one: read what would change, or make the change approved.
      if (options.dryRun === Option.isSome(options.approve)) {
        return yield* Effect.fail(
          new Error(
            "Give --dry-run to read what would change, or --approve <token> to make exactly that change.",
          ),
        );
      }
      if (
        Option.isSome(options.description) &&
        Option.isSome(options.descriptionFile)
      ) {
        return yield* Effect.fail(
          new Error("Give --description or --description-file, not both."),
        );
      }
      const file = Option.getOrUndefined(options.descriptionFile);
      const description =
        file === undefined
          ? Option.getOrUndefined(options.description)
          : yield* Effect.tryPromise({
              try: () => Bun.file(file).text(),
              catch: (cause) =>
                new Error(`${file} could not be read: ${String(cause)}`),
            });
      const edit: TalkEdit = {
        ...(Option.isSome(options.title) ? { title: options.title.value } : {}),
        ...(description === undefined ? {} : { description }),
        ...(options.speaker.length === 0
          ? {}
          : { speakers: options.speaker.map(speakerOf) }),
      };
      if (Option.isNone(options.approve)) {
        const { change, token } = yield* planTalkEdit(options.talk, edit);
        return yield* Console.log(
          options.json
            ? JSON.stringify({ dryRun: true, change, token }, null, 2)
            : [
                ...changeLines(change),
                ...(changesAnything(change)
                  ? [
                      `approval token: ${token}`,
                      `Nothing was changed. To make exactly this change: ${[
                        "bun run talks update",
                        shellWord(options.talk),
                        ...Option.match(options.title, {
                          onNone: () => [],
                          onSome: (title) => ["--title", shellWord(title)],
                        }),
                        ...Option.match(options.descriptionFile, {
                          onNone: () =>
                            Option.match(options.description, {
                              onNone: () => [],
                              onSome: (text) => [
                                "--description",
                                shellWord(text),
                              ],
                            }),
                          onSome: (path) => [
                            "--description-file",
                            shellWord(path),
                          ],
                        }),
                        ...options.speaker.flatMap((speaker) => [
                          "--speaker",
                          shellWord(speaker),
                        ]),
                        "--approve",
                        token,
                      ].join(" ")}`,
                    ]
                  : ["Nothing to change: the talk already reads so."]),
              ].join("\n"),
        );
      }
      const change = yield* editTalk(options.talk, edit, options.approve.value);
      return yield* Console.log(
        options.json
          ? JSON.stringify({ dryRun: false, change }, null, 2)
          : [
              changesAnything(change)
                ? `Updated talk ${change.talk.id}.`
                : `Talk ${change.talk.id} already read so; nothing changed.`,
              ...changeLines(change).slice(1),
            ].join("\n"),
      );
    }).pipe(Effect.provide(Database.layer)),
).pipe(
  Command.withDescription(
    "Edit a talk's title, description and speakers, exactly as a dry run showed it.",
  ),
);

const talks = Command.make("talks").pipe(
  Command.withDescription("Talks: list an evening's, and edit one."),
  Command.withSubcommands([list, update]),
);

Command.run(talks, { version: "1.0.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
