import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import * as Database from "../src/database.ts";
import { EventProgram } from "../src/rows.ts";
import {
  formatAll,
  formatHits,
  formatHost,
  formatIdea,
  formatSpeaker,
} from "../src/planning/format.ts";
import {
  type CompanyRef,
  HostChanges,
  HostStatus,
  IdeaChanges,
  IdeaStatus,
  NewContact,
  NewHostProspect,
  NewIdea,
  NewWantedSpeaker,
  type NoteSubject,
  type PersonRef,
  SpeakerChanges,
  SpeakerStatus,
  Day,
  Topic,
  WindowInput,
} from "../src/planning/model.ts";
import { rollingBackIf } from "../src/planning/dry-run.ts";
import {
  type DraftPerson,
  type DraftTalk,
  Planning,
  PlanningError,
} from "../src/planning/planning.ts";
import {
  auditPlanning,
  formatAudit,
  isPrivate,
} from "../src/planning/privacy.ts";

/**
 * Organizers' planning (src/planning/) at the Postgres at DATABASE_URL:
 * ideas for evenings, speakers we'd like and when they're free, companies
 * we'd like to host, and notes. Every command takes --json, which the
 * admin MCP server's planning tools read.
 *
 *   bun run plan idea add --title … --pitch … --program social [--topic …] [--inspired-by <slug>]
 *   bun run plan idea list [--status idea]
 *   bun run plan idea update <id> [--status drafting --event <slug>] [--clear-topic] …
 *   bun run plan speaker add --profile <id or name> --topic effect [--window '{"startsOn":"2027-01-01","note":"free after Dec"}']
 *   bun run plan speaker add --name "Ada" [--email …] [--url …] [--company <host>] --topic ai
 *   bun run plan speaker list [--topic ai] [--status wanted] [--available-on 2026-12-03]
 *   bun run plan speaker update <id> [--status asked] [--add-topic …] [--add-window …] [--remove-window <id>]
 *   bun run plan host add --sponsor <id or name> | --company "New Co" [--contact-name …] [--note …]
 *   bun run plan host list [--status prospect]
 *   bun run plan host update <id> --status asked
 *   bun run plan note add --profile <id or name> | --sponsor … | --contact <id> --body … [--author Erik]
 *   bun run plan lineup set <draft slug> --mc "Erik Thorelli" --organizer "Erik Thorelli" --organizer "Andre Landgraf"
 *   bun run plan lineup show <draft slug>
 *   bun run plan lineup talk add <draft slug> --kind panel --title "…" --moderator <wanted id> --panelist <wanted id> --panelist <wanted id>
 *   bun run plan lineup talk list <draft slug>
 *   bun run plan lineup talk remove <draft slug> <talk id>
 *   bun run plan search <text>
 *   bun run plan audit        prove no site role may read planning; fails if one may
 *
 * Every command that writes takes --dry-run: the write runs for real in a
 * transaction that is rolled back, so it prints exactly what it would be,
 * refuses what it would refuse, and keeps nothing.
 *
 * It reads and writes the planning schema, as the studio (core's README,
 * "The studio's connection"); no site role may use it. The rows are private: never put them in a file in this
 * repository. DATABASE_URL comes from the environment only; .env files are
 * not read.
 */

const layer = Planning.layer.pipe(Layer.provideMerge(Database.layer));

const dryRun = Flag.Boolean("dry-run").pipe(
  Flag.withDescription(
    "Make the change in a transaction that is rolled back: print what it would be, keep nothing.",
  ),
  Flag.withDefault(false),
);

const json = Flag.Boolean("json").pipe(
  Flag.withDescription("Print the result as JSON."),
  Flag.withDefault(false),
);

const text = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.withDescription(description), Flag.optional);

const repeated = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.withDescription(description), Flag.atLeast(0));

const clear = (name: string, description: string) =>
  Flag.Boolean(name).pipe(
    Flag.withDescription(description),
    Flag.withDefault(false),
  );

const literal = <const L extends ReadonlyArray<string>>(
  name: string,
  values: L,
  description: string,
) =>
  Flag.Literals(name, values).pipe(
    Flag.withDescription(`${description} (${values.join(", ")}).`),
    Flag.optional,
  );

const refuse = (reason: string) => Effect.fail(new PlanningError({ reason }));

/** `fields` without the ones left out, decoded by `schema`. */
const decode = <S extends Schema.Top>(
  schema: S,
  fields: Record<string, unknown>,
) =>
  Schema.decodeUnknownEffect(schema)(
    Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    ),
  ).pipe(
    Effect.mapError((error) => new PlanningError({ reason: error.message })),
  );

const value = <A>(option: Option.Option<A>): A | undefined =>
  Option.getOrUndefined(option);

/** A setting, or null with its clearing flag; both at once is refused. */
const setOrClear = (
  name: string,
  option: Option.Option<string>,
  cleared: boolean,
): Effect.Effect<string | null | undefined, PlanningError> => {
  if (cleared && Option.isSome(option)) {
    return refuse(`Give --${name} or --clear-${name}, not both.`);
  }
  return Effect.succeed(cleared ? null : value(option));
};

const windows = (raw: ReadonlyArray<string>) =>
  Effect.forEach(raw, (window) =>
    Effect.try({
      try: () => JSON.parse(window) as unknown,
      catch: () =>
        new PlanningError({
          reason: `--window takes JSON, such as {"startsOn":"2027-01-01","note":"free after Dec"}: ${window}`,
        }),
    }).pipe(
      Effect.flatMap((parsed) =>
        Schema.decodeUnknownEffect(WindowInput)(parsed).pipe(
          Effect.mapError(
            (error) => new PlanningError({ reason: error.message }),
          ),
        ),
      ),
    ),
  );

/** After a --dry-run write's output, that nothing was kept (not in JSON). */
const dryRunNote = (options: {
  readonly dryRun: boolean;
  readonly json: boolean;
}) =>
  options.dryRun && !options.json
    ? Console.log("Dry run: rolled back, nothing was kept.")
    : Effect.void;

const print = <A>(asJson: boolean, result: A, format: (result: A) => string) =>
  Console.log(asJson ? JSON.stringify(result, null, 2) : format(result));

/** Who --profile, --contact or --name (with its details) name: exactly one. */
const personFrom = (options: {
  readonly profile: Option.Option<string>;
  readonly contact: Option.Option<string>;
  readonly name: Option.Option<string>;
  readonly email: Option.Option<string>;
  readonly url: Option.Option<string>;
  readonly company: Option.Option<string>;
  readonly prefix?: string;
}) =>
  Effect.gen(function* () {
    const p = options.prefix ?? "";
    const given = [options.profile, options.contact, options.name].filter(
      Option.isSome,
    ).length;
    if (given !== 1) {
      return yield* refuse(
        p === ""
          ? "Name one person: --profile <id or name>, --contact <id>, or --name for someone new."
          : "Name one contact: --contact <id>, or --contact-name for someone new.",
      );
    }
    if (Option.isSome(options.profile)) {
      const ref: PersonRef = { _tag: "Profile", ref: options.profile.value };
      return ref;
    }
    if (Option.isSome(options.contact)) {
      const ref: PersonRef = { _tag: "Contact", id: options.contact.value };
      return ref;
    }
    const contact = yield* decode(NewContact, {
      name: value(options.name),
      email: value(options.email),
      url: value(options.url),
      company: value(options.company),
    });
    const ref: PersonRef = { _tag: "NewContact", contact };
    return ref;
  });

const ideaAdd = Command.make(
  "add",
  {
    title: Flag.String("title").pipe(Flag.withDescription("What it's called.")),
    pitch: Flag.String("pitch").pipe(
      Flag.withDescription("What the evening is, in a few sentences."),
    ),
    program: Flag.Literals("program", EventProgram.literals).pipe(
      Flag.withDescription("What kind of evening it is."),
    ),
    topic: text("topic", "allthings/<topic>, as event topics are written."),
    status: literal("status", IdeaStatus.literals, "Where it stands"),
    event: text("event", "The draft evening it became, by slug."),
    inspiredBy: text("inspired-by", "A past evening it builds on, by slug."),
    json,
    dryRun,
  },
  (options) =>
    Effect.gen(function* () {
      const idea = yield* decode(NewIdea, {
        title: options.title,
        pitch: options.pitch,
        program: options.program,
        topic: value(options.topic),
        status: value(options.status),
        eventSlug: value(options.event),
        inspiredBySlug: value(options.inspiredBy),
      });
      const added = yield* Planning.use((planning) => planning.addIdea(idea));
      yield* print(options.json, added, formatIdea);
    }).pipe(
      rollingBackIf(options.dryRun),
      Effect.tap(() => dryRunNote(options)),
      Effect.provide(layer),
    ),
).pipe(Command.withDescription("Add an idea for an evening."));

const ideaList = Command.make(
  "list",
  { status: literal("status", IdeaStatus.literals, "Only these"), json },
  (options) =>
    Planning.use((planning) =>
      planning.listIdeas(
        Option.isSome(options.status) ? { status: options.status.value } : {},
      ),
    ).pipe(
      Effect.flatMap((ideas) =>
        print(options.json, ideas, (rows) =>
          formatAll(rows, formatIdea, "No ideas."),
        ),
      ),
      Effect.provide(layer),
    ),
).pipe(Command.withDescription("List ideas, oldest first."));

const ideaUpdate = Command.make(
  "update",
  {
    id: Argument.String("id").pipe(Argument.withDescription("The idea's id.")),
    title: text("title", "A new title."),
    pitch: text("pitch", "A new pitch."),
    program: Flag.Literals("program", EventProgram.literals).pipe(
      Flag.withDescription("What kind of evening it is."),
      Flag.optional,
    ),
    topic: text("topic", "A new topic."),
    clearTopic: clear("clear-topic", "Remove its topic."),
    status: literal("status", IdeaStatus.literals, "Where it stands"),
    event: text("event", "The draft evening it became, by slug."),
    clearEvent: clear("clear-event", "Unlink its event."),
    inspiredBy: text("inspired-by", "A past evening it builds on, by slug."),
    clearInspiredBy: clear(
      "clear-inspired-by",
      "Unlink the evening it builds on.",
    ),
    json,
    dryRun,
  },
  (options) =>
    Effect.gen(function* () {
      const changes = yield* decode(IdeaChanges, {
        title: value(options.title),
        pitch: value(options.pitch),
        program: value(options.program),
        topic: yield* setOrClear("topic", options.topic, options.clearTopic),
        status: value(options.status),
        eventSlug: yield* setOrClear(
          "event",
          options.event,
          options.clearEvent,
        ),
        inspiredBySlug: yield* setOrClear(
          "inspired-by",
          options.inspiredBy,
          options.clearInspiredBy,
        ),
      });
      const updated = yield* Planning.use((planning) =>
        planning.updateIdea(options.id, changes),
      );
      yield* print(options.json, updated, formatIdea);
    }).pipe(
      rollingBackIf(options.dryRun),
      Effect.tap(() => dryRunNote(options)),
      Effect.provide(layer),
    ),
).pipe(Command.withDescription("Change an idea."));

const idea = Command.make("idea").pipe(
  Command.withDescription("Ideas for evenings."),
  Command.withSubcommands([ideaAdd, ideaList, ideaUpdate]),
);

const windowFlag = (name: string) =>
  repeated(
    name,
    'An availability window as JSON: {"kind":"available"|"unavailable","startsOn":"YYYY-MM-DD","endsOn":"YYYY-MM-DD","note":"…"}, each part optional. Repeat for more.',
  );

const speakerAdd = Command.make(
  "add",
  {
    profile: text("profile", "Their profile, by id or exact name."),
    contact: text("contact", "A contact already stored, by id."),
    name: text("name", "Someone new, without a profile: their name."),
    email: text("email", "Someone new: their email."),
    url: text("url", "Someone new: a link to them (https)."),
    company: text("company", "Someone new: the hosting company they work at."),
    topic: Flag.String("topic").pipe(
      Flag.withDescription("What they could speak about; repeat for more."),
      Flag.atLeast(1),
    ),
    status: literal("status", SpeakerStatus.literals, "Where we are with them"),
    note: text("note", "Why them, or what's been said."),
    window: windowFlag("window"),
    json,
    dryRun,
  },
  (options) =>
    Effect.gen(function* () {
      const person = yield* personFrom(options);
      const speaker = yield* decode(NewWantedSpeaker, {
        topics: options.topic,
        status: value(options.status),
        note: value(options.note),
        availability: yield* windows(options.window),
      });
      const added = yield* Planning.use((planning) =>
        planning.addWantedSpeaker(person, speaker),
      );
      yield* print(options.json, added, formatSpeaker);
    }).pipe(
      rollingBackIf(options.dryRun),
      Effect.tap(() => dryRunNote(options)),
      Effect.provide(layer),
    ),
).pipe(Command.withDescription("Add a speaker we'd like on stage."));

const speakerList = Command.make(
  "list",
  {
    topic: text("topic", "Only those who could speak about this."),
    status: literal("status", SpeakerStatus.literals, "Only these"),
    availableOn: text(
      "available-on",
      "Only those free on this day (YYYY-MM-DD).",
    ),
    json,
  },
  (options) =>
    Effect.gen(function* () {
      const topic = value(options.topic);
      if (topic !== undefined)
        yield* decode(Topic, { topic }).pipe(Effect.asVoid);
      const day = value(options.availableOn);
      if (day !== undefined) {
        yield* Schema.decodeUnknownEffect(Day)(day).pipe(
          Effect.mapError(
            (error) => new PlanningError({ reason: error.message }),
          ),
        );
      }
      const speakers = yield* Planning.use((planning) =>
        planning.listWantedSpeakers({
          ...(topic === undefined ? {} : { topic }),
          ...(Option.isSome(options.status)
            ? { status: options.status.value }
            : {}),
          ...(day === undefined ? {} : { availableOn: day }),
        }),
      );
      yield* print(options.json, speakers, (rows) =>
        formatAll(rows, formatSpeaker, "No wanted speakers."),
      );
    }).pipe(Effect.provide(layer)),
).pipe(Command.withDescription("List wanted speakers, by name."));

const speakerUpdate = Command.make(
  "update",
  {
    id: Argument.String("id").pipe(
      Argument.withDescription("The wanted speaker's id."),
    ),
    status: literal("status", SpeakerStatus.literals, "Where we are with them"),
    note: text("note", "A new note."),
    clearNote: clear("clear-note", "Remove the note."),
    addTopic: repeated("add-topic", "A topic to add; repeat for more."),
    removeTopic: repeated(
      "remove-topic",
      "A topic to remove; repeat for more.",
    ),
    addWindow: windowFlag("add-window"),
    removeWindow: repeated(
      "remove-window",
      "An availability window to remove, by id; repeat for more.",
    ),
    json,
    dryRun,
  },
  (options) =>
    Effect.gen(function* () {
      const changes = yield* decode(SpeakerChanges, {
        status: value(options.status),
        note: yield* setOrClear("note", options.note, options.clearNote),
        addTopics: options.addTopic,
        removeTopics: options.removeTopic,
        addAvailability: yield* windows(options.addWindow),
        removeAvailability: options.removeWindow,
      });
      const updated = yield* Planning.use((planning) =>
        planning.updateWantedSpeaker(options.id, changes),
      );
      yield* print(options.json, updated, formatSpeaker);
    }).pipe(
      rollingBackIf(options.dryRun),
      Effect.tap(() => dryRunNote(options)),
      Effect.provide(layer),
    ),
).pipe(Command.withDescription("Change a wanted speaker."));

const speaker = Command.make("speaker").pipe(
  Command.withDescription(
    "Speakers we'd like on stage, and when they're free.",
  ),
  Command.withSubcommands([speakerAdd, speakerList, speakerUpdate]),
);

const hostAdd = Command.make(
  "add",
  {
    sponsor: text("sponsor", "A hosting company we know, by id or exact name."),
    company: text("company", "A company we don't know yet, by name."),
    contact: text(
      "contact",
      "Who to talk to: a contact already stored, by id.",
    ),
    contactName: text(
      "contact-name",
      "Who to talk to, someone new: their name.",
    ),
    contactEmail: text("contact-email", "Someone new: their email."),
    contactUrl: text("contact-url", "Someone new: a link to them (https)."),
    status: literal("status", HostStatus.literals, "Where we are with them"),
    note: text("note", "Why them, or what's been said."),
    json,
    dryRun,
  },
  (options) =>
    Effect.gen(function* () {
      if (Option.isSome(options.sponsor) === Option.isSome(options.company)) {
        return yield* refuse(
          "Name one company: --sponsor for one we know, or --company for a new one.",
        );
      }
      const company: CompanyRef = Option.isSome(options.sponsor)
        ? { _tag: "Host", ref: options.sponsor.value }
        : {
            _tag: "NewCompany",
            name: Option.getOrElse(options.company, () => ""),
          };
      const contact =
        Option.isNone(options.contact) && Option.isNone(options.contactName)
          ? undefined
          : yield* personFrom({
              profile: Option.none(),
              contact: options.contact,
              name: options.contactName,
              email: options.contactEmail,
              url: options.contactUrl,
              company: options.sponsor,
              prefix: "contact-",
            });
      const prospect = yield* decode(NewHostProspect, {
        status: value(options.status),
        note: value(options.note),
      });
      const added = yield* Planning.use((planning) =>
        planning.addHostProspect(company, contact, prospect),
      );
      return yield* print(options.json, added, formatHost);
    }).pipe(
      rollingBackIf(options.dryRun),
      Effect.tap(() => dryRunNote(options)),
      Effect.provide(layer),
    ),
).pipe(Command.withDescription("Add a company we'd like to host an evening."));

const hostList = Command.make(
  "list",
  { status: literal("status", HostStatus.literals, "Only these"), json },
  (options) =>
    Planning.use((planning) =>
      planning.listHostProspects(
        Option.isSome(options.status) ? { status: options.status.value } : {},
      ),
    ).pipe(
      Effect.flatMap((hosts) =>
        print(options.json, hosts, (rows) =>
          formatAll(rows, formatHost, "No host prospects."),
        ),
      ),
      Effect.provide(layer),
    ),
).pipe(
  Command.withDescription(
    "List host prospects, by name, with when each last hosted.",
  ),
);

const hostUpdate = Command.make(
  "update",
  {
    id: Argument.String("id").pipe(
      Argument.withDescription("The host prospect's id."),
    ),
    status: literal("status", HostStatus.literals, "Where we are with them"),
    note: text("note", "A new note."),
    clearNote: clear("clear-note", "Remove the note."),
    json,
    dryRun,
  },
  (options) =>
    Effect.gen(function* () {
      const changes = yield* decode(HostChanges, {
        status: value(options.status),
        note: yield* setOrClear("note", options.note, options.clearNote),
      });
      const updated = yield* Planning.use((planning) =>
        planning.updateHostProspect(options.id, changes),
      );
      yield* print(options.json, updated, formatHost);
    }).pipe(
      rollingBackIf(options.dryRun),
      Effect.tap(() => dryRunNote(options)),
      Effect.provide(layer),
    ),
).pipe(Command.withDescription("Change a host prospect."));

const host = Command.make("host").pipe(
  Command.withDescription("Companies we'd like to host an evening."),
  Command.withSubcommands([hostAdd, hostList, hostUpdate]),
);

const noteAdd = Command.make(
  "add",
  {
    profile: text("profile", "About a profile, by id or exact name."),
    sponsor: text("sponsor", "About a hosting company, by id or exact name."),
    contact: text("contact", "About a contact, by id."),
    body: Flag.String("body").pipe(Flag.withDescription("The note.")),
    author: text("author", "Who wrote it."),
    json,
    dryRun,
  },
  (options) =>
    Effect.gen(function* () {
      const subjects = [
        options.profile,
        options.sponsor,
        options.contact,
      ].filter(Option.isSome);
      if (subjects.length !== 1) {
        return yield* refuse(
          "Name what the note is about: one of --profile, --sponsor or --contact.",
        );
      }
      const subject: NoteSubject = Option.isSome(options.profile)
        ? { _tag: "Profile", ref: options.profile.value }
        : Option.isSome(options.sponsor)
          ? { _tag: "Host", ref: options.sponsor.value }
          : {
              _tag: "Contact",
              id: Option.getOrElse(options.contact, () => ""),
            };
      const author = value(options.author);
      const added = yield* Planning.use((planning) =>
        author === undefined
          ? planning.addNote(subject, options.body)
          : planning.addNote(subject, options.body, author),
      );
      return yield* print(
        options.json,
        added,
        (note) => `note ${note.id} on ${note.about}: ${note.body}`,
      );
    }).pipe(
      rollingBackIf(options.dryRun),
      Effect.tap(() => dryRunNote(options)),
      Effect.provide(layer),
    ),
).pipe(Command.withDescription("Add a note on a person or a company."));

const note = Command.make("note").pipe(
  Command.withDescription("Notes on the people and companies we know."),
  Command.withSubcommands([noteAdd]),
);

/** A draft's private lineup, one line each, by role and order. */
const formatLineup = (people: ReadonlyArray<DraftPerson>): string =>
  people.length === 0
    ? "No lineup."
    : people
        .map((person) => `${person.role}: ${person.name} (${person.profileId})`)
        .join("\n");

const draftSlug = Argument.String("slug").pipe(
  Argument.withDescription("The draft evening, by slug."),
);

const lineupSet = Command.make(
  "set",
  {
    slug: draftSlug,
    organizer: repeated(
      "organizer",
      "An organizer, by profile id or exact name; repeat, in order.",
    ),
    coHost: repeated(
      "co-host",
      "A co-host, by profile id or exact name; repeat, in order.",
    ),
    mc: repeated(
      "mc",
      "The MC, by profile id or exact name; repeat, in order.",
    ),
    json,
    dryRun,
  },
  (options) =>
    Planning.use((planning) =>
      planning.setDraftLineup(options.slug, [
        ...options.organizer.map((profile) => ({
          role: "organizer" as const,
          profile,
        })),
        ...options.coHost.map((profile) => ({
          role: "co-host" as const,
          profile,
        })),
        ...options.mc.map((profile) => ({ role: "mc" as const, profile })),
      ]),
    ).pipe(
      Effect.flatMap((people) => print(options.json, people, formatLineup)),
      rollingBackIf(options.dryRun),
      Effect.tap(() => dryRunNote(options)),
      Effect.provide(layer),
    ),
).pipe(
  Command.withDescription(
    "Make the whole private lineup of a draft evening: organizers, co-hosts, MC. Publishing copies it to the evening.",
  ),
);

const lineupShow = Command.make("show", { slug: draftSlug, json }, (options) =>
  Planning.use((planning) => planning.draftLineup(options.slug)).pipe(
    Effect.flatMap((people) => print(options.json, people, formatLineup)),
    Effect.provide(layer),
  ),
).pipe(Command.withDescription("A draft evening's private lineup."));

/** A draft's private talks, in running order, each with its people and whether they've said yes. */
const formatTalks = (talks: ReadonlyArray<DraftTalk>): string =>
  talks.length === 0
    ? "No talks."
    : talks
        .map((talk) =>
          [
            `${talk.position}. ${talk.kind}: ${talk.title} (${talk.id})`,
            ...(talk.description === null ? [] : [`   ${talk.description}`]),
            ...(talk.people.length === 0
              ? ["   nobody on it yet"]
              : talk.people.map(
                  (person) =>
                    `   ${person.role}: ${person.name} [${person.status}]${person.profileId === null ? " · no profile yet" : ""} (${person.wantedSpeakerId})`,
                )),
          ].join("\n"),
        )
        .join("\n\n");

const talkAdd = Command.make(
  "add",
  {
    slug: draftSlug,
    title: Flag.String("title").pipe(Flag.withDescription("What it's called.")),
    kind: Flag.Literals("kind", ["talk", "panel", "fireside"]).pipe(
      Flag.withDescription(
        "What it is (talk, panel, fireside): a talk has speakers, a panel a moderator and panelists, a fireside a moderator and a speaker.",
      ),
    ),
    description: text("description", "What it's about."),
    moderator: text("moderator", "The moderator, by wanted speaker id."),
    panelist: repeated(
      "panelist",
      "A panelist, by wanted speaker id; repeat, in order.",
    ),
    speaker: repeated(
      "speaker",
      "A speaker, by wanted speaker id; repeat, in order.",
    ),
    json,
    dryRun,
  },
  (options) => {
    const description = value(options.description);
    const moderator = value(options.moderator);
    return Planning.use((planning) =>
      planning.addDraftTalk(options.slug, {
        kind: options.kind,
        title: options.title,
        ...(description === undefined ? {} : { description }),
        people: [
          ...(moderator === undefined
            ? []
            : [{ role: "moderator" as const, wantedSpeaker: moderator }]),
          ...options.panelist.map((wantedSpeaker) => ({
            role: "panelist" as const,
            wantedSpeaker,
          })),
          ...options.speaker.map((wantedSpeaker) => ({
            role: "speaker" as const,
            wantedSpeaker,
          })),
        ],
      }),
    ).pipe(
      Effect.flatMap((talks) => print(options.json, talks, formatTalks)),
      rollingBackIf(options.dryRun),
      Effect.tap(() => dryRunNote(options)),
      Effect.provide(layer),
    );
  },
).pipe(
  Command.withDescription(
    "Add a talk, panel or fireside to a draft evening, after its others, with its people by their wanted speaker ids; whether they've said yes is their status there.",
  ),
);

const talkRemove = Command.make(
  "remove",
  {
    slug: draftSlug,
    id: Argument.String("id").pipe(
      Argument.withDescription("The talk's id, as talk list shows it."),
    ),
    json,
    dryRun,
  },
  (options) =>
    Planning.use((planning) =>
      planning.removeDraftTalk(options.slug, options.id),
    ).pipe(
      Effect.flatMap((talks) => print(options.json, talks, formatTalks)),
      rollingBackIf(options.dryRun),
      Effect.tap(() => dryRunNote(options)),
      Effect.provide(layer),
    ),
).pipe(
  Command.withDescription("Take a talk, and its people, off a draft evening."),
);

const talkList = Command.make("list", { slug: draftSlug, json }, (options) =>
  Planning.use((planning) => planning.draftTalks(options.slug)).pipe(
    Effect.flatMap((talks) => print(options.json, talks, formatTalks)),
    Effect.provide(layer),
  ),
).pipe(
  Command.withDescription(
    "A draft evening's private talks, in running order, with who's on each and whether they've said yes.",
  ),
);

const lineupTalk = Command.make("talk").pipe(
  Command.withDescription(
    "An unpublished evening's talks, panels and firesides, kept private with people who may not have said yes yet.",
  ),
  Command.withSubcommands([talkAdd, talkRemove, talkList]),
);

const lineup = Command.make("lineup").pipe(
  Command.withDescription(
    "An unpublished evening's organizers, co-hosts, MC and talks, kept private until it is published.",
  ),
  Command.withSubcommands([lineupSet, lineupShow, lineupTalk]),
);

const search = Command.make(
  "search",
  {
    query: Argument.String("text").pipe(
      Argument.withDescription("Text to find, anywhere, in any case."),
    ),
    json,
  },
  (options) =>
    Planning.use((planning) => planning.search(options.query)).pipe(
      Effect.flatMap((hits) => print(options.json, hits, formatHits)),
      Effect.provide(layer),
    ),
).pipe(
  Command.withDescription(
    "Search ideas, wanted speakers, host prospects, contacts and notes.",
  ),
);

const audit = Command.make("audit", { json }, (options) =>
  Effect.gen(function* () {
    const result = yield* auditPlanning;
    yield* print(options.json, result, formatAudit);
    if (isPrivate(result)) return undefined;
    return yield* refuse(
      result.schemaExists
        ? "A site role or PUBLIC may reach planning."
        : "There is no planning schema to audit.",
    );
  }).pipe(Effect.provide(Database.layer)),
).pipe(
  Command.withDescription(
    "Check that site_reader, site_sync and PUBLIC can't reach planning; fails if one can, or if there is no planning schema.",
  ),
);

const plan = Command.make("plan").pipe(
  Command.withDescription(
    "Organizers' planning: ideas, speakers, hosts, notes.",
  ),
  Command.withSubcommands([idea, speaker, host, note, lineup, search, audit]),
);

// A refusal is the answer, not a crash: its reason alone, on stderr, and exit 1.
Command.run(plan, { version: "1.0.0" }).pipe(
  Effect.catchTag("PlanningError", (refusal) =>
    Effect.sync(() => {
      console.error(refusal.reason);
      process.exitCode = 1;
    }),
  ),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
