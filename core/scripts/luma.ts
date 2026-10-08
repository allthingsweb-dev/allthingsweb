import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as Database from "../src/database.ts";
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

/**
 * An evening's Luma event, from private draft to public (src/luma/publish.ts),
 * with the calendar's key in LUMA_API_KEY and the database at DATABASE_URL:
 *
 *   bun run luma create --name "allthings/effect" --start 2026-11-18T18:00:00-08:00 \
 *     --end 2026-11-18T21:00:00-08:00 --venue "CodeRabbit, 201 Spear St" [--idea <id>] [--dry-run]
 *   bun run luma update --event <draft slug> --description-from-drafts [--cover cover.png] [--dry-run]
 *   bun run luma update --luma evt-… --description-from-idea <id> [--dry-run]   the idea's pitch, as create sets it
 *   bun run luma update --luma evt-… --name "…"        before the sync has stored it
 *   bun run luma publish <draft slug> --dry-run        what would go out, and its approval token
 *   bun run luma publish <draft slug> --approve <token>   put out exactly that
 *   bun run luma show evt-…                            the event as Luma has it
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

const coverOf = (path: string) =>
  Effect.gen(function* () {
    const bytes = new Uint8Array(
      yield* Effect.promise(() => Bun.file(path).arrayBuffer()),
    );
    const png = [0x89, 0x50, 0x4e, 0x47].every((byte, i) => bytes[i] === byte);
    const jpeg = [0xff, 0xd8, 0xff].every((byte, i) => bytes[i] === byte);
    if (!png && !jpeg) {
      return yield* refuse(`${path} is neither a PNG nor a JPEG.`);
    }
    return {
      bytes,
      contentType: png ? ("image/png" as const) : ("image/jpeg" as const),
    };
  });

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
    cover: text("cover", "A PNG or JPEG to upload as its cover."),
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
      const cover = Option.isSome(options.cover)
        ? yield* coverOf(options.cover.value)
        : undefined;
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
            ...(cover === undefined ? {} : { cover }),
          },
          options.dryRun,
        ),
      );
      return yield* print(
        options.json,
        result,
        `${options.dryRun ? "Would update" : "Updated"} ${result.lumaEventId}:\n${JSON.stringify(result.body, null, 2)}${options.dryRun && cover !== undefined ? "\n(and upload the cover)" : ""}`,
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

const luma = Command.make("luma").pipe(
  Command.withDescription(
    "An evening's Luma event, from private draft to public.",
  ),
  Command.withSubcommands([create, update, publish, show, cancelTest]),
);

// A refusal is the answer, not a crash: its reason alone, on stderr, and exit 1.
Command.run(luma, { version: "1.0.0" }).pipe(
  Effect.catchTag("StudioRefused", (refusal) =>
    Effect.sync(() => {
      console.error(refusal.reason);
      process.exitCode = 1;
    }),
  ),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
