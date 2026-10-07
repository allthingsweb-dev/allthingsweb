import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { z } from "zod";
import * as server from "../../app/src/lib/public-api/schemas.ts";
import * as core from "../src/contract.ts";
import community from "./fixtures/community.json";
import eventDetails from "./fixtures/event-details.json";
import events from "./fixtures/events.json";
import speakers from "./fixtures/speakers.json";

/**
 * Holds the Effect contract to the zod one the app serves today: the same
 * JSON Schema (which is what MCP clients and agents see), the same verdicts on
 * valid and invalid values, and lossless decoding of live responses.
 *
 * The fixtures are live MCP responses captured from allthingsweb.dev.
 *
 * One description differs on purpose: an event's page is on allthings.dev,
 * where the app still names its own host. The exception goes with app/.
 */
const appEventPage = "Event page on allthingsweb.dev.";
const eventPage = "Event page on allthings.dev.";

type Pair = readonly [
  name: string,
  effect: Schema.Codec<unknown, unknown>,
  zod: z.ZodType,
];

const pairs: ReadonlyArray<Pair> = [
  ["EventSummary", core.EventSummary, server.eventSummarySchema],
  ["Event", core.Event, server.eventSchema],
  ["Speaker", core.Speaker, server.speakerSchema],
  ["Community", core.Community, server.communitySchema],
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

/** The app's JSON Schema, with its event-page description as core words it. */
function zodJsonSchema(schema: z.ZodType): Json {
  const json = JSON.stringify(z.toJSONSchema(schema));
  return normalize(
    JSON.parse(
      json.replaceAll(JSON.stringify(appEventPage), JSON.stringify(eventPage)),
    ) as Json,
  );
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

describe("JSON Schema", () => {
  test.each(pairs)("%s matches the served zod schema", (_, effect, zod) => {
    expect(effectJsonSchema(effect)).toEqual(zodJsonSchema(zod));
  });

  test("an event's page is on allthings.dev, where the app names allthingsweb.dev", () => {
    for (const [, effect, zod] of pairs.slice(0, 2)) {
      expect(JSON.stringify(effectJsonSchema(effect))).toContain(eventPage);
      expect(JSON.stringify(z.toJSONSchema(zod))).toContain(appEventPage);
    }
  });
});

describe("live responses", () => {
  const live: ReadonlyArray<readonly [string, Pair, ReadonlyArray<unknown>]> = [
    ["list_events", pairs[0]!, events.events],
    ["get_event", pairs[1]!, eventDetails.events],
    ["list_speakers", pairs[2]!, speakers.speakers],
    ["get_community", pairs[3]!, [community]],
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

describe("verdicts", () => {
  const base = events.events[0]!;
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

  // zod trims and strips tabs and newlines; served URLs must already be clean.
  test.each([
    " https://allthings.dev",
    "https://allthings.dev\n",
    "https://all\tthings.dev",
  ])("url %j is normalized by zod but rejected here", (url) => {
    expect(zodVerdict(summaryZod, withField("url", url)).ok).toBe(true);
    expect(effectVerdict(summary, withField("url", url)).ok).toBe(false);
  });
});
