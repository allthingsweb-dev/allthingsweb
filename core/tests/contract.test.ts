import { describe, expect, test } from "bun:test";
import { DateTime, Schema } from "effect";
import { z } from "zod";
import { isEventNotFound } from "../../cli/src/client.ts";
import * as cliCoach from "../../cli/src/coach.ts";
import * as cli from "../../cli/src/schemas.ts";
import * as coaching from "../src/coaching.ts";
import * as core from "../src/contract.ts";
import { EventNotFound } from "../src/errors.ts";
import { guideAt, toGuide } from "../src/guide.ts";
import community from "./fixtures/community.json";
import eventDetails from "./fixtures/event-details.json";
import events from "./fixtures/events.json";
import speakers from "./fixtures/speakers.json";

/**
 * Holds the CLI's zod copy of the contract (cli/src/schemas.ts) to the
 * contract itself: the same JSON Schema (which is what MCP clients and
 * agents see), the same verdicts on valid and invalid values, and lossless
 * decoding of live responses. The app's zod schemas are legacy and no longer
 * a reference.
 *
 * The fixtures are live MCP responses captured from allthingsweb.dev
 * before events said whose they are; each is read with the fields it lacks
 * as they were then, every evening ours.
 */

type Pair = readonly [
  name: string,
  effect: Schema.Codec<unknown, unknown>,
  zod: z.ZodType,
];

const pairs: ReadonlyArray<Pair> = [
  ["EventSummary", core.EventSummary, cli.eventSummarySchema],
  ["Event", core.Event, cli.eventSchema],
  ["Speaker", core.Speaker, cli.speakerSchema],
  ["Community", core.Community, cli.communitySchema],
  ["Guide", core.Guide, cli.guideSchema],
  ["Coaching", coaching.Coaching, cli.coachingSchema],
];

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Puts both generators' output in one form. Dropped: `$schema`, `pattern`
 * (the verdict tests below compare behavior instead of regex spelling) and
 * `additionalProperties` (both accept and strip unknown keys).
 */
function normalize(node: Json): Json {
  if (Array.isArray(node)) return node.map(normalize);
  if (node === null || typeof node !== "object") return node;
  const { $schema, pattern, additionalProperties, ...rest } = node;
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(rest)) out[key] = normalize(value);
  const type = out["type"];
  if (Array.isArray(type)) {
    const { type: _, description, ...facets } = out;
    return normalize({
      ...(description === undefined ? {} : { description }),
      anyOf: type.map((t) =>
        t === "null" ? { type: t } : { type: t, ...facets },
      ),
    });
  }
  if ("const" in out) {
    const { const: value, ...others } = out;
    return { ...others, enum: [value ?? null] };
  }
  return out;
}

function effectJsonSchema(schema: Schema.Top): Json {
  const document = Schema.toJsonSchemaDocument(schema);
  expect(document.definitions).toEqual({});
  return normalize(document.schema as Json);
}

function zodJsonSchema(schema: z.ZodType): Json {
  return normalize(z.toJSONSchema(schema) as Json);
}

type Verdict = { ok: true; value: unknown } | { ok: false };

function effectVerdict(
  schema: Schema.Codec<unknown, unknown>,
  input: unknown,
): Verdict {
  try {
    return { ok: true, value: Schema.decodeUnknownSync(schema)(input) };
  } catch {
    return { ok: false };
  }
}

function zodVerdict(schema: z.ZodType, input: unknown): Verdict {
  const result = schema.safeParse(input);
  return result.success ? { ok: true, value: result.data } : { ok: false };
}

/** A captured event with whose it is, as every evening then was: ours. */
const asOurs = (event: object) => ({
  ...event,
  curation: "ours",
  organizer: null,
});

/**
 * A captured event with its talks' links, as every talk then had: none,
 * since talks had no links of their own before talk_artifacts.
 */
const withLinks = (event: { readonly talks: ReadonlyArray<object> }) => ({
  ...event,
  talks: event.talks.map((talk) => ({
    ...talk,
    recording: null,
    artifacts: [],
  })),
});

/**
 * `schema` without its descriptions. They are what agents read, and the
 * MCP server serves them from this contract; the CLI's copy needs only the
 * shapes.
 */
const shape = (schema: Json): Json =>
  JSON.parse(
    JSON.stringify(schema, (key, value: Json) =>
      key === "description" ? undefined : value,
    ),
  );

describe("JSON Schema", () => {
  test.each(pairs)("%s has the CLI's zod schema's shape", (_, effect, zod) => {
    expect(shape(effectJsonSchema(effect))).toEqual(shape(zodJsonSchema(zod)));
  });
});

describe("live responses", () => {
  const live: ReadonlyArray<readonly [string, Pair, ReadonlyArray<unknown>]> = [
    ["list_events", pairs[0]!, events.events.map(asOurs)],
    ["get_event", pairs[1]!, eventDetails.events.map(withLinks).map(asOurs)],
    ["list_speakers", pairs[2]!, speakers.speakers],
    ["get_community", pairs[3]!, [community]],
    [
      "get_guide",
      pairs[4]!,
      // The guide is written by hand: as it is served today, and once every
      // written edition is over.
      [Date.UTC(2026, 10, 13), Date.UTC(2028, 0, 1)].map((at) =>
        toGuide(guideAt(DateTime.makeUnsafe(at)), "https://allthings.dev"),
      ),
    ],
  ];

  test.each(live)(
    "%s decodes losslessly, as zod parses it",
    (_, pair, values) => {
      const [, effect, zod] = pair;
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        const decoded = Schema.decodeUnknownSync(effect)(value);
        expect(Schema.encodeSync(effect)(decoded)).toEqual(value);
        expect(decoded).toEqual(zod.parse(value));
      }
    },
  );
});

describe("coaching", () => {
  test("the CLI's limits, goals and formats are core's", () => {
    expect(cli.coachingLimits).toEqual(coaching.limits);
    expect(cli.maxSlotMinutes).toBe(coaching.maxSlotMinutes);
    expect<Readonly<Record<string, number>>>(cliCoach.defaultMinutes).toEqual(
      coaching.defaultMinutes,
    );
    expect([...cli.goals]).toEqual([...coaching.Goal.literals]);
    expect([...cli.slotFormats]).toEqual([...coaching.SlotFormat.literals]);
  });

  test("coach_talk's answers decode losslessly, as zod parses them", () => {
    const [, effect, zod] = pairs.find(([name]) => name === "Coaching")!;
    for (const materials of [
      { slot: { format: "open-floor", minutes: 3 } },
      {
        slot: { format: "talk", minutes: 20 },
        title: "A queue",
        outline: "# I'm Sam\nI built a queue\n---\nDemo\n---\ngithub.com/sam/q",
        transcript:
          "WEBVTT\n\n00:00.000 --> 00:30.000\nHi, I'm Sam, um, and I built a queue. Book a demo.",
        goals: ["find-contributors", "get-hired"],
      },
    ] as const) {
      const value = coaching.coach(materials);
      const decoded = Schema.decodeUnknownSync(effect)(value);
      expect(Schema.encodeSync(effect)(decoded)).toEqual(value);
      expect(decoded).toEqual(zod.parse(value));
    }
  });
});

describe("verdicts", () => {
  const base = asOurs(events.events[0]!);
  const [, summary, summaryZod] = pairs[0]!;
  const withField = (key: string, value: unknown) => ({
    ...base,
    [key]: value,
  });
  const without = (key: string) =>
    Object.fromEntries(Object.entries(base).filter(([k]) => k !== key));

  const cases: ReadonlyArray<readonly [string, unknown]> = [
    ["a live event", base],
    ["an unknown extra key", withField("extra", 1)],
    ["a missing key", without("tagline")],
    ["a null venue", withField("venue", null)],
    ["a shared evening", withField("curation", "shared")],
    ["an unknown curation", withField("curation", "theirs")],
    [
      "an organizer with a site",
      withField("organizer", { name: "Mastra", url: "https://mastra.ai/" }),
    ],
    [
      "an organizer without a site",
      withField("organizer", { name: "Mastra", url: null }),
    ],
    ["an organizer without a name", withField("organizer", { url: null })],
    [
      "an organizer's site that isn't a URL",
      withField("organizer", { name: "Mastra", url: "mastra" }),
    ],
    ["a venue with a missing name", withField("venue", { address: null })],
    ["an unknown status", withField("status", "cancelled")],
    ["another time zone", withField("timeZone", "UTC")],
    ...[
      "https://allthings.dev/events/x",
      "http://allthings.dev",
      "HTTPS://ALLTHINGS.DEV/",
      "https://xn--bcher-kva.example/",
      "https://sub.domain.example.co.uk/a?b=c#d",
      "https://localhost:3000",
      "https://127.0.0.1/",
      "https://a.b",
      "ftp://allthings.dev",
      "https:/allthings.dev",
      "https:allthings.dev",
      "https://exa mple.com",
      "allthings.dev",
      "",
    ].map(
      (url) => [`url ${JSON.stringify(url)}`, withField("url", url)] as const,
    ),
    ...[
      "2026-10-01T00:30:00.000Z",
      "2026-10-01T00:30:00Z",
      "2026-10-01T00:30:00.123456Z",
      "2028-02-29T00:00:00Z",
      "2000-02-29T00:00:00Z",
      "1900-02-29T00:00:00Z",
      "2026-02-29T00:00:00Z",
      "2026-04-31T00:00:00Z",
      "2026-13-01T00:00:00Z",
      "2026-10-01T24:00:00Z",
      "2026-10-01T00:30Z",
      "2026-10-01T00:30:00",
      "2026-10-01T00:30:00+00:00",
      "2026-10-01 00:30:00Z",
      "2026-10-01",
    ].map(
      (instant) =>
        [
          `startsAt ${JSON.stringify(instant)}`,
          withField("startsAt", instant),
        ] as const,
    ),
  ];

  test.each(cases)("%s gets the same verdict and value", (_, input) => {
    expect(effectVerdict(summary, input)).toEqual(
      zodVerdict(summaryZod, input),
    );
  });

  // zod trims and strips tabs and newlines; served URLs must already be
  // clean, so the contract rejects them and the CLI, which only reads what
  // the server serves, lets them through: every URL field alike, an
  // organizer's site too.
  const unclean = [
    " https://allthings.dev",
    "https://allthings.dev\n",
    "https://all\tthings.dev",
  ];
  test.each(unclean)("url %j is normalized by zod but rejected here", (url) => {
    expect(zodVerdict(summaryZod, withField("url", url)).ok).toBe(true);
    expect(effectVerdict(summary, withField("url", url)).ok).toBe(false);
  });
  test.each(unclean)(
    "an organizer's site %j is normalized by zod but rejected here",
    (url) => {
      const input = withField("organizer", { name: "Mastra", url });
      expect(zodVerdict(summaryZod, input).ok).toBe(true);
      expect(effectVerdict(summary, input).ok).toBe(false);
    },
  );
});

describe("a guide entry's days", () => {
  const [, guide, guideZod] = pairs[4]!;
  const [entry] = toGuide(
    guideAt(DateTime.makeUnsafe(Date.UTC(2026, 10, 13))),
    "https://allthings.dev",
  ).entries;
  const withDays = (from: unknown, to: unknown) => ({
    about: "x",
    url: "https://allthings.dev/guide",
    entries: [{ ...entry, next: { from, to } }],
  });

  test.each([
    "2027-04-26",
    "2028-02-29",
    "2027-02-29",
    "2027-04-31",
    "2027-4-26",
    "2027-04-26T00:00:00Z",
    "",
  ])("%j gets the same verdict and value", (day) => {
    const input = withDays(day, "2027-04-27");
    expect(effectVerdict(guide, input)).toEqual(zodVerdict(guideZod, input));
  });

  test.each([0, 4, "3"])("stars %j get the same verdict", (stars) => {
    const input = {
      about: "x",
      url: "https://allthings.dev/guide",
      entries: [{ ...entry, stars }],
    };
    expect(effectVerdict(guide, input)).toEqual(zodVerdict(guideZod, input));
    expect(effectVerdict(guide, input).ok).toBe(false);
  });
});

describe("errors", () => {
  test("the CLI recognizes get_event's not-found message", () => {
    expect(
      isEventNotFound(new EventNotFound({ slug: "no-such-event" }).message),
    ).toBe(true);
  });
});
