import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import { CoverRenderer } from "../src/cover.ts";
import * as Database from "../src/database.ts";
import { EventPages } from "../src/event-page.ts";
import { Calendar, type PreparedCalendar } from "../src/luma/calendar.ts";
import { Covers, type PreparedCover } from "../src/luma/cover.ts";
import {
  type PreparedRegistration,
  type Question,
  type Registration,
  type RegistrationChange,
  type RegistrationRequest,
  questionsInOrder,
  Registrations,
} from "../src/luma/registration.ts";
import {
  type EventRef,
  instant,
  type Prepared,
  StudioRefused,
  Studio,
  testEventPrefix,
} from "../src/luma/publish.ts";
import type { LumaPlace } from "../src/luma/write.ts";
import { LumaWrite } from "../src/luma/write.ts";
import { Planning } from "../src/planning/planning.ts";
import { Promo } from "../src/promo/promo.ts";
import { Readiness } from "../src/readiness/readiness.ts";
import { ShortSlugs } from "../src/slugs.ts";
import { shellWord } from "./shell.ts";

/**
 * An evening's Luma event, from private draft to public (src/luma/publish.ts),
 * with the calendar's key in LUMA_API_KEY and the database at DATABASE_URL:
 *
 *   bun run luma create --name "allthings/effect" --start 2026-11-18T18:00:00-08:00 \
 *     --end 2026-11-18T21:00:00-08:00 --venue "CodeRabbit, 201 Spear St" [--idea <id>] [--dry-run]
 *   bun run luma update --event <draft slug> --description-from-drafts [--dry-run]
 *   bun run luma update --luma evt-… --description-from-idea <id> [--dry-run]   the idea's pitch, as create sets it
 *   bun run luma update --luma evt-… --name "…"        before the sync has stored it
 *   bun run luma publish <draft slug> --dry-run        what would go out, and its approval token
 *   bun run luma publish <draft slug> --approve <token>   put out exactly that
 *   bun run luma cover <slug|evt-…> --dry-run          draw its cover from its facts, and the token
 *   bun run luma cover <slug|evt-…> --approve <token>  set exactly that cover on its private event
 *   bun run luma show evt-…                            the event as Luma has it
 *   bun run luma calendar --dry-run [--slug <slug>]    how the calendar's page differs from the brand, and the token
 *   bun run luma calendar --approve <token> [--slug <slug>]   make exactly those changes
 *   bun run luma registration --event <slug|evt-…>     approval, waitlist, capacity and questions, as Luma has them
 *   bun run luma registration --event <slug> --approval on --capacity 120 --question "Your team?" \
 *     --question-optional "Anything we should know?" --dry-run    each change and its token; nothing sent
 *   bun run luma registration --event <slug> … --approve <token>   make exactly those changes
 *   bun run luma cancel-test evt-…                     delete a test event (see testEventPrefix)
 *
 * Every event is made private; only publish, with the token of what was
 * read, makes one public. Times carry their offset (-08:00 or -07:00 in
 * San Francisco). DATABASE_URL and LUMA_API_KEY come from the environment
 * only; .env files are not read.
 */

const layer = Studio.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      LumaWrite.layer.pipe(Layer.provide(FetchHttpClient.layer)),
      Planning.layer,
      Promo.layer,
      Readiness.layer,
    ),
  ),
  Layer.provideMerge(Database.layer),
);

const refuse = (reason: string) => Effect.fail(new StudioRefused({ reason }));

const json = Flag.Boolean("json").pipe(
  Flag.withDescription("Print the result as JSON."),
  Flag.withDefault(false),
);
const dryRun = Flag.Boolean("dry-run").pipe(
  Flag.withDescription("Print what would be sent to Luma; send nothing."),
  Flag.withDefault(false),
);
const text = (name: string, description: string) =>
  Flag.String(name).pipe(Flag.withDescription(description), Flag.optional);

const time = (name: string, option: Option.Option<string>) =>
  Option.match(option, {
    onNone: () => Effect.succeed(undefined),
    onSome: (value) => {
      const iso = instant(value);
      return iso === undefined
        ? refuse(
            `--${name} is a time with its offset, such as 2026-11-18T18:00:00-08:00: ${value}`,
          )
        : Effect.succeed(iso);
    },
  });

/** Where it is: --venue for a place Google Maps knows (its name shows), or --address as written. */
const placeOf = (
  venue: Option.Option<string>,
  address: Option.Option<string>,
): Effect.Effect<LumaPlace | undefined, StudioRefused> => {
  if (Option.isSome(venue) && Option.isSome(address)) {
    return refuse("Give --venue or --address, not both.");
  }
  if (Option.isSome(venue)) {
    return Effect.succeed({ type: "lookup", query: venue.value });
  }
  if (Option.isSome(address)) {
    return Effect.succeed({ type: "manual", address: address.value });
  }
  return Effect.succeed(undefined);
};

const print = (asJson: boolean, value: unknown, lines: string) =>
  Console.log(asJson ? JSON.stringify(value, null, 2) : lines);

const venueFlags = {
  venue: text(
    "venue",
    'The place, as Google Maps finds it (its name shows on Luma), such as "CodeRabbit, 201 Spear St".',
  ),
  address: text(
    "address",
    "The address as written, when Google Maps has no place for it.",
  ),
};

const create = Command.make(
  "create",
  {
    name: Flag.String("name").pipe(
      Flag.withDescription("The evening's name on Luma."),
    ),
    start: Flag.String("start").pipe(
      Flag.withDescription("When it starts, with its offset."),
    ),
    end: Flag.String("end").pipe(
      Flag.withDescription("When it ends, with its offset."),
    ),
    ...venueFlags,
    idea: text(
      "idea",
      "The idea it comes from: its pitch is the first description.",
    ),
    slug: text("slug", "Its address on Luma (luma.com/<slug>)."),
    capacity: Flag.Int("capacity").pipe(
      Flag.withDescription("Most guests Luma takes."),
      Flag.optional,
    ),
    dryRun,
    json,
  },
  (options) =>
    Effect.gen(function* () {
      const startAt = yield* time("start", Option.some(options.start));
      const endAt = yield* time("end", Option.some(options.end));
      const place = yield* placeOf(options.venue, options.address);
      if (place === undefined)
        return yield* refuse("Give --venue or --address.");
      const result = yield* Studio.use((studio) =>
        studio.create(
          {
            name: options.name,
            startAt: startAt ?? "",
            endAt: endAt ?? "",
            place,
            ...(Option.isSome(options.idea)
              ? { ideaId: options.idea.value }
              : {}),
            ...(Option.isSome(options.slug)
              ? { slug: options.slug.value }
              : {}),
            ...(Option.isSome(options.capacity)
              ? { capacity: options.capacity.value }
              : {}),
          },
          options.dryRun,
        ),
      );
      return yield* print(
        options.json,
        result,
        result.lumaEventId === null
          ? `Would create, private:\n${JSON.stringify(result.body, null, 2)}`
          : `Created ${result.lumaEventId}, private. Store it as a draft with bun run luma:drafts --add ${result.lumaEventId} (the feed never carries a private event); then link the idea with plan idea update <id> --status drafting --event <slug>.`,
      );
    }).pipe(Effect.provide(layer)),
).pipe(Command.withDescription("Make an evening's Luma event, private."));

const update = Command.make(
  "update",
  {
    event: text("event", "The draft, by its slug here."),
    luma: text(
      "luma",
      "The event, by its Luma id, before the sync has stored it.",
    ),
    name: text("name", "A new name."),
    start: text("start", "When it starts, with its offset."),
    end: text("end", "When it ends, with its offset."),
    ...venueFlags,
    descriptionFromDrafts: Flag.Boolean("description-from-drafts").pipe(
      Flag.withDescription(
        "Set the description the promotion drafts write (needs --event).",
      ),
      Flag.withDefault(false),
    ),
    descriptionFromIdea: text(
      "description-from-idea",
      "Set the description to this idea's pitch, as create does, by the idea's id.",
    ),
    dryRun,
    json,
  },
  (options) =>
    Effect.gen(function* () {
      if (Option.isSome(options.event) === Option.isSome(options.luma)) {
        return yield* refuse("Name one event: --event <slug> or --luma <id>.");
      }
      if (options.descriptionFromDrafts && Option.isNone(options.event)) {
        return yield* refuse(
          "--description-from-drafts needs the draft: --event <slug>.",
        );
      }
      const ref: EventRef = Option.isSome(options.event)
        ? { _tag: "Slug", slug: options.event.value }
        : {
            _tag: "Luma",
            lumaEventId: Option.getOrElse(options.luma, () => ""),
          };
      const startAt = yield* time("start", options.start);
      const endAt = yield* time("end", options.end);
      const place = yield* placeOf(options.venue, options.address);
      const result = yield* Studio.use((studio) =>
        studio.update(
          ref,
          {
            ...(Option.isSome(options.name)
              ? { name: options.name.value }
              : {}),
            ...(startAt === undefined ? {} : { startAt }),
            ...(endAt === undefined ? {} : { endAt }),
            ...(place === undefined ? {} : { place }),
            ...(options.descriptionFromDrafts && Option.isSome(options.event)
              ? { descriptionFromDrafts: options.event.value }
              : {}),
            ...(Option.isSome(options.descriptionFromIdea)
              ? { descriptionFromIdea: options.descriptionFromIdea.value }
              : {}),
          },
          options.dryRun,
        ),
      );
      return yield* print(
        options.json,
        result,
        `${options.dryRun ? "Would update" : "Updated"} ${result.lumaEventId}:\n${JSON.stringify(result.body, null, 2)}`,
      );
    }).pipe(Effect.provide(layer)),
).pipe(Command.withDescription("Change a private Luma event."));

const describe = (prepared: Prepared) => {
  const { outgoing } = prepared;
  return [
    `${outgoing.name} · ${outgoing.lumaEventId} · ${outgoing.url}`,
    `${prepared.from} → public`,
    `when: ${outgoing.startAt} to ${outgoing.endAt ?? "?"} (${outgoing.timezone})`,
    `where: ${outgoing.address ?? "no address"}`,
    `cover: ${outgoing.coverUrl ?? "none"}`,
    `lineup copied from planning: ${prepared.lineup.length === 0 ? "none" : prepared.lineup.map((person) => `${person.role} ${person.name}`).join(", ")}`,
    `description (${outgoing.descriptionMd.length} characters):`,
    "---",
    outgoing.descriptionMd,
    "---",
    `approval token: ${prepared.token}`,
  ].join("\n");
};

const publish = Command.make(
  "publish",
  {
    slug: Argument.String("slug").pipe(
      Argument.withDescription("The draft's slug."),
    ),
    approve: text(
      "approve",
      "The token publish --dry-run printed for what was read and approved: only that goes out.",
    ),
    dryRun,
    json,
  },
  (options) =>
    Effect.gen(function* () {
      // Exactly one: read what would go out, or put out what was approved.
      if (options.dryRun === Option.isSome(options.approve)) {
        return yield* refuse(
          "Give --dry-run to read what would go out, or --approve <token> to put out exactly that.",
        );
      }
      if (Option.isNone(options.approve)) {
        const prepared = yield* Studio.use((studio) =>
          studio.prepare(options.slug),
        );
        return yield* print(
          options.json,
          prepared,
          `${describe(prepared)}\nNothing was sent. To put out exactly this: bun run luma publish ${options.slug} --approve ${prepared.token}`,
        );
      }
      const token = options.approve.value;
      const published = yield* Studio.use((studio) =>
        studio.publish(options.slug, token),
      );
      return yield* print(
        options.json,
        published,
        `Published: ${published.url}\n${describe(published)}`,
      );
    }).pipe(Effect.provide(layer)),
).pipe(
  Command.withDescription(
    "Say what publishing would put out, or put out exactly what was approved.",
  ),
);

const show = Command.make(
  "show",
  {
    luma: Argument.String("luma-event-id").pipe(
      Argument.withDescription("The event, by its Luma id."),
    ),
  },
  (options) =>
    LumaWrite.use((write) => write.get(options.luma)).pipe(
      Effect.flatMap((event) => Console.log(JSON.stringify(event, null, 2))),
      Effect.provide(
        LumaWrite.layer.pipe(Layer.provide(FetchHttpClient.layer)),
      ),
    ),
).pipe(Command.withDescription("Print a Luma event as its manager sees it."));

const cancelTest = Command.make(
  "cancel-test",
  {
    luma: Argument.String("luma-event-id").pipe(
      Argument.withDescription(
        `A private test event named "${testEventPrefix}…".`,
      ),
    ),
  },
  (options) =>
    Studio.use((studio) => studio.cancelTest(options.luma)).pipe(
      Effect.flatMap(({ name }) =>
        Console.log(`Cancelled ${name}: Luma deleted it.`),
      ),
      Effect.provide(layer),
    ),
).pipe(Command.withDescription("Delete one of the studio's own test events."));

const calendarLayer = Calendar.layer.pipe(
  Layer.provide(LumaWrite.layer),
  Layer.provide(FetchHttpClient.layer),
);

const describeCalendar = (prepared: PreparedCalendar) =>
  [
    `${prepared.url} · ${prepared.calendarId}`,
    prepared.changes.length === 0
      ? "nothing to change"
      : prepared.changes
          .map(
            (change) =>
              `${change.field}: ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`,
          )
          .join("\n"),
    `by hand in Luma's settings (its API can't): the cover (now ${prepared.byHand.coverImageUrl ?? "none"}) and the social preview image (now ${prepared.byHand.socialImageUrl ?? "none"})`,
  ].join("\n");

const calendar = Command.make(
  "calendar",
  {
    slug: text(
      "slug",
      "Also move the calendar to luma.com/<slug>. Links to the old address stop working.",
    ),
    approve: text(
      "approve",
      "The token calendar --dry-run printed for the changes that were read: only those are made.",
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription(
        "Print each change and its approval token; change nothing.",
      ),
      Flag.withDefault(false),
    ),
    json,
  },
  (options) =>
    Effect.gen(function* () {
      if (options.dryRun === Option.isSome(options.approve)) {
        return yield* refuse(
          "Give --dry-run to read the changes, or --approve <token> to make exactly those.",
        );
      }
      const slug = Option.isSome(options.slug)
        ? { slug: options.slug.value }
        : {};
      const again = `bun run luma calendar${Option.isSome(options.slug) ? ` --slug ${shellWord(options.slug.value)}` : ""}`;
      if (Option.isNone(options.approve)) {
        const prepared = yield* Calendar.use((c) => c.prepare(slug));
        return yield* print(
          options.json,
          prepared,
          `${describeCalendar(prepared)}\napproval token: ${prepared.token}\nNothing was changed. To make exactly these changes: ${again} --approve ${prepared.token}`,
        );
      }
      const token = options.approve.value;
      const made = yield* Calendar.use((c) => c.approve(token, slug));
      return yield* print(
        options.json,
        made,
        `Changed:\n${describeCalendar(made)}`,
      );
    }).pipe(Effect.provide(calendarLayer)),
).pipe(
  Command.withDescription(
    "Say how the Luma calendar's page differs from the brand, or make exactly the approved changes.",
  ),
);

const coverLayer = Covers.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      LumaWrite.layer.pipe(Layer.provide(FetchHttpClient.layer)),
      EventPages.layer,
      ShortSlugs.layer,
      CoverRenderer.layer,
    ),
  ),
  Layer.provideMerge(Database.layer),
);

/** A cover as it prints: the PNG itself stays out of JSON. */
const coverJson = ({ png, ...rest }: PreparedCover) => ({
  ...rest,
  bytes: png.length,
});

const describeCover = (prepared: PreparedCover, file: string | null) => {
  const { facts, current } = prepared;
  const lockup =
    facts.topic === null
      ? facts.name
      : `allthings/${facts.topic}${facts.ahead ? "_" : ""}`;
  return [
    `${prepared.name} · ${prepared.lumaEventId} · ${prepared.visibility}`,
    `says: ${[
      lockup,
      `${facts.date} ${facts.time} ${facts.year}`,
      facts.neighborhood,
      facts.hosts === null ? facts.venue : `hosted at ${facts.hosts}`,
      facts.link,
    ]
      .filter((part) => part !== null)
      .join(" · ")} (${facts.mode})`,
    `drawn: ${file ?? "(in memory)"} (${(prepared.png.length / 1e6).toFixed(1)} MB, sha256 ${prepared.sha256})`,
    `replaces: ${current.url ?? "no cover"}${current.lumaDefault ? " (Luma's default)" : current.ours ? " (ours, as last set)" : current.url === null ? "" : " (not ours)"}`,
  ].join("\n");
};

const cover = Command.make(
  "cover",
  {
    event: Argument.String("event").pipe(
      Argument.withDescription(
        "The evening: its slug here or its short link, or its Luma id (evt-…).",
      ),
    ),
    approve: text(
      "approve",
      "The token cover --dry-run printed for the cover that was looked at: only that is set.",
    ),
    out: text(
      "out",
      "Where --dry-run writes the drawn PNG to look at; by default a fresh temporary directory.",
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription(
        "Draw the cover, write it to look at, and print its approval token; send nothing.",
      ),
      Flag.withDefault(false),
    ),
    json,
  },
  (options) =>
    Effect.gen(function* () {
      if (options.dryRun === Option.isSome(options.approve)) {
        return yield* refuse(
          "Give --dry-run to draw the cover and read it, or --approve <token> to set exactly that.",
        );
      }
      const ref: EventRef = options.event.startsWith("evt-")
        ? { _tag: "Luma", lumaEventId: options.event }
        : { _tag: "Slug", slug: options.event };
      if (Option.isNone(options.approve)) {
        const prepared = yield* Covers.use((covers) => covers.prepare(ref));
        const file = Option.isSome(options.out)
          ? options.out.value
          : join(
              yield* Effect.promise(() =>
                mkdtemp(join(tmpdir(), "allthings-cover-")),
              ),
              `${prepared.slug}.png`,
            );
        yield* Effect.promise(() => Bun.write(file, prepared.png));
        const next =
          prepared.refused === null
            ? `approval token: ${prepared.token}\nNothing was sent. To set exactly this: bun run luma cover ${shellWord(options.event)} --approve ${prepared.token}`
            : `Nothing was sent, and approving it would be refused: ${prepared.refused}`;
        // Drawn, but not to be set: the cover to look at, and exit 1.
        if (prepared.refused !== null) process.exitCode = 1;
        return yield* print(
          options.json,
          { ...coverJson(prepared), file },
          `${describeCover(prepared, file)}\n${next}`,
        );
      }
      const token = options.approve.value;
      const set = yield* Covers.use((covers) => covers.approve(ref, token));
      return yield* print(
        options.json,
        { ...coverJson(set), coverUrl: set.coverUrl },
        `Set: ${set.coverUrl}\n${describeCover(set, null)}`,
      );
    }).pipe(Effect.provide(coverLayer)),
).pipe(
  Command.withDescription(
    "Draw an evening's cover from its facts, or set exactly the one approved on its private Luma event.",
  ),
);

const registrationLayer = Registrations.layer.pipe(
  Layer.provide(LumaWrite.layer.pipe(Layer.provide(FetchHttpClient.layer))),
  Layer.provideMerge(Database.layer),
);

const onOff = (on: boolean) => (on ? "on" : "off");
const capacityText = (capacity: number | null) =>
  capacity === null ? "no limit" : String(capacity);
const questionLine = (question: Question, index: number) =>
  `${index + 1}. ${JSON.stringify(question.label)} (${question.required ? "required" : "optional"}${question.type === "text" ? "" : `, ${question.type}`})`;

const describeRegistration = (registration: Registration) =>
  [
    `${registration.name} · ${registration.lumaEventId} · ${registration.visibility}`,
    `approval: ${onOff(registration.approval)} · waitlist: ${onOff(registration.waitlist)} · capacity: ${capacityText(registration.capacity)}`,
    registration.questions.length === 0
      ? "questions: none"
      : `questions:\n${registration.questions.map((q, i) => `  ${questionLine(q, i)}`).join("\n")}`,
    `ticket types: ${
      registration.tickets.length === 0
        ? "none"
        : registration.tickets
            .map(
              (ticket) =>
                `${ticket.name}${ticket.hidden ? " (hidden)" : ""}, approval ${onOff(ticket.requireApproval)}`,
            )
            .join("; ")
    }`,
  ].join("\n");

const describeChange = (change: RegistrationChange) => {
  if (change.field === "approval") {
    return `approval: ${onOff(change.from)} → ${onOff(change.to)} (on ticket types ${change.ticketTypes.join(", ")})`;
  }
  if (change.field === "waitlist") {
    return `waitlist: ${onOff(change.from)} → ${onOff(change.to)}`;
  }
  if (change.field === "capacity") {
    return `capacity: ${capacityText(change.from)} → ${capacityText(change.to)}`;
  }
  const list = (questions: ReadonlyArray<Question>) =>
    questions.length === 0
      ? "    none"
      : questions.map((q, i) => `    ${questionLine(q, i)}`).join("\n");
  return `questions, from:\n${list(change.from)}\n  to:\n${list(change.to)}`;
};

const describePlan = (prepared: PreparedRegistration) =>
  [
    describeRegistration(prepared.registration),
    prepared.changes.length === 0
      ? "nothing to change"
      : `changes:\n${prepared.changes.map((change) => `  ${describeChange(change)}`).join("\n")}`,
    ...prepared.gaps.map(
      (gap) =>
        `✗ ${gap.field}, which Luma's API can't set as asked: ${gap.reason}`,
    ),
    ...(prepared.public && prepared.changes.length > 0
      ? ["This event is public: guests see these changes at once."]
      : []),
  ].join("\n");

/** --capacity: a whole number, or none for no limit. */
const capacityOf = (option: Option.Option<string>) =>
  Option.match(option, {
    onNone: () => Effect.succeed(undefined),
    onSome: (value) =>
      value === "none"
        ? Effect.succeed(null)
        : /^\d+$/.test(value)
          ? Effect.succeed(Number(value))
          : refuse(
              `--capacity is a whole number, or none for no limit: ${value}`,
            ),
  });

const registration = Command.make(
  "registration",
  {
    event: Flag.String("event").pipe(
      Flag.withDescription(
        "The evening: its slug here or its short link, or its Luma id (evt-…).",
      ),
    ),
    approval: Flag.Literals("approval", ["on", "off"]).pipe(
      Flag.withDescription(
        "Whether registering needs an organizer's approval (set on every ticket type).",
      ),
      Flag.optional,
    ),
    waitlist: Flag.Literals("waitlist", ["on", "off"]).pipe(
      Flag.withDescription("Whether a full event takes a waitlist."),
      Flag.optional,
    ),
    capacity: text("capacity", "Most guests Luma takes, or none for no limit."),
    question: Flag.String("question").pipe(
      Flag.withDescription(
        "A required question; repeat. With --question-optional, the questions are the whole list, in the order given.",
      ),
      Flag.atLeast(0),
    ),
    questionOptional: Flag.String("question-optional").pipe(
      Flag.withDescription("An optional question; repeat."),
      Flag.atLeast(0),
    ),
    clearQuestions: Flag.Boolean("clear-questions").pipe(
      Flag.withDescription("Ask no questions."),
      Flag.withDefault(false),
    ),
    approve: text(
      "approve",
      "The token --dry-run printed for the changes that were read: only those are made.",
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription(
        "Print each change and its approval token; change nothing.",
      ),
      Flag.withDefault(false),
    ),
    json,
  },
  (options) =>
    Effect.gen(function* () {
      const ref: EventRef = options.event.startsWith("evt-")
        ? { _tag: "Luma", lumaEventId: options.event }
        : { _tag: "Slug", slug: options.event };
      const asked = options.question.length + options.questionOptional.length;
      if (options.clearQuestions && asked > 0) {
        return yield* refuse("Give questions or --clear-questions, not both.");
      }
      const questions = questionsInOrder(process.argv);
      if (questions.length !== asked) {
        return yield* refuse(
          "The questions couldn't be read in order: give each as --question <label> or --question-optional <label>.",
        );
      }
      const capacity = yield* capacityOf(options.capacity);
      const request: RegistrationRequest = {
        ...(Option.isSome(options.approval)
          ? { approval: options.approval.value === "on" }
          : {}),
        ...(Option.isSome(options.waitlist)
          ? { waitlist: options.waitlist.value === "on" }
          : {}),
        ...(capacity === undefined ? {} : { capacity }),
        ...(options.clearQuestions
          ? { questions: [] }
          : asked > 0
            ? { questions }
            : {}),
      };
      const changing = Object.keys(request).length > 0;
      if (!changing) {
        if (options.dryRun || Option.isSome(options.approve)) {
          return yield* refuse(
            "Nothing to change: give --approval, --waitlist, --capacity, questions or --clear-questions.",
          );
        }
        const now = yield* Registrations.use((r) => r.read(ref));
        return yield* print(options.json, now, describeRegistration(now));
      }
      if (options.dryRun === Option.isSome(options.approve)) {
        return yield* refuse(
          "Give --dry-run to read the changes, or --approve <token> to make exactly those.",
        );
      }
      if (Option.isNone(options.approve)) {
        const prepared = yield* Registrations.use((r) =>
          r.prepare(ref, request),
        );
        const again = [
          "bun run luma registration --event",
          shellWord(options.event),
          ...(Option.isSome(options.approval)
            ? [`--approval ${options.approval.value}`]
            : []),
          ...(Option.isSome(options.waitlist)
            ? [`--waitlist ${options.waitlist.value}`]
            : []),
          ...(Option.isSome(options.capacity)
            ? [`--capacity ${shellWord(options.capacity.value)}`]
            : []),
          ...(options.clearQuestions ? ["--clear-questions"] : []),
          ...questions.map(
            (question) =>
              `--question${question.required ? "" : "-optional"} ${shellWord(question.label)}`,
          ),
        ].join(" ");
        const next =
          prepared.gaps.length > 0
            ? "Nothing was sent, and approving it would be refused."
            : prepared.changes.length === 0
              ? "Nothing was sent: registration is already so."
              : `approval token: ${prepared.token}\nNothing was sent. To make exactly these changes: ${again} --approve ${prepared.token}`;
        // A gap is refused: the plan to read, and exit 1.
        if (prepared.gaps.length > 0) process.exitCode = 1;
        return yield* print(
          options.json,
          prepared,
          `${describePlan(prepared)}\n${next}`,
        );
      }
      const token = options.approve.value;
      const made = yield* Registrations.use((r) =>
        r.approve(ref, request, token),
      );
      return yield* print(
        options.json,
        made,
        `Changed:\n${made.changes.map(describeChange).join("\n")}\nNow:\n${describeRegistration(made.registration)}`,
      );
    }).pipe(Effect.provide(registrationLayer)),
).pipe(
  Command.withDescription(
    "An evening's registration on Luma (approval, waitlist, capacity, questions): read it, or make exactly the approved changes.",
  ),
);

const luma = Command.make("luma").pipe(
  Command.withDescription(
    "An evening's Luma event, from private draft to public.",
  ),
  Command.withSubcommands([
    create,
    update,
    publish,
    cover,
    show,
    calendar,
    registration,
    cancelTest,
  ]),
);

// A refusal is the answer, not a crash: its reason alone, on stderr, and exit 1.
Command.run(luma, { version: "1.0.0" }).pipe(
  Effect.catchTags({
    StudioRefused: (refusal) =>
      Effect.sync(() => {
        console.error(refusal.reason);
        process.exitCode = 1;
      }),
    CoverUnrendered: (failure) =>
      Effect.sync(() => {
        console.error(failure.reason);
        process.exitCode = 1;
      }),
  }),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
