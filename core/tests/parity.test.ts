import { afterAll, describe, expect, mock, test } from "bun:test";
import { DateTime, Effect, Layer, Schema } from "effect";
import * as Contract from "../src/contract.ts";
import { EventNotFound } from "../src/errors.ts";
import { Events } from "../src/events.ts";
import * as Mappers from "../src/mappers.ts";
import { htmlToPlainText, sanitizeRichText } from "../src/rich-text.ts";
import { Speakers } from "../src/speakers.ts";
import {
  clockLayer,
  now,
  seededDatabase,
  sqlLayer,
} from "./support/database.ts";

/**
 * Runs the app's own MCP tools, wired to its own drizzle queries as
 * app/src/app/mcp/route.ts wires them, and core's repositories and mappers
 * against one seeded database, and requires the same answers. This is what
 * lets the Worker replace the app without clients noticing.
 *
 * The app's modules are loaded at runtime rather than imported: the app's own
 * compiler checks them, and core's stricter settings would reject code that is
 * not being changed here. The narrow types below are all this test relies on.
 */

type ToolResult = {
  readonly isError?: boolean;
  readonly content: ReadonlyArray<{ readonly text: string }>;
  readonly structuredContent?: unknown;
};
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;
type ToolServer = {
  registerTool(name: string, config: unknown, handler: ToolHandler): void;
};

const app = new URL("../../app/", import.meta.url);
const load = (path: string): Promise<unknown> =>
  import(new URL(path, app).href);
const appPackage = (name: string): Promise<unknown> =>
  import(Bun.resolveSync(name, app.pathname));

const origin = "https://allthingsweb.dev";
const db = await seededDatabase();

const { drizzle } = (await appPackage("drizzle-orm/pglite")) as {
  drizzle: (config: { client: unknown }) => unknown;
};
const appDb = drizzle({ client: db });
// The app reads its database and config from modules; point them here.
await mock.module(new URL("src/lib/db.ts", app).pathname, () => ({
  db: appDb,
}));
await mock.module(new URL("src/lib/config.ts", app).pathname, () => ({
  mainConfig: { s3: { url: "https://storage.example" } },
}));

const { registerAtwTools } = (await load("src/lib/mcp/tools.ts")) as {
  registerAtwTools: (server: ToolServer, deps: unknown) => void;
};
const { getPublishedEvents } = (await load("src/lib/published-events.ts")) as {
  getPublishedEvents: () => Promise<unknown>;
};
const { getExpandedEventBySlug } = (await load(
  "src/lib/expanded-events.ts",
)) as { getExpandedEventBySlug: (slug: string) => Promise<unknown> };
const { getSpeakerDirectory } = (await load(
  "src/lib/speaker-directory.ts",
)) as {
  getSpeakerDirectory: (database: unknown, at: Date) => Promise<unknown>;
};

const { htmlToPlainText: appPlainText, httpUrlOrNull: appHttpUrlOrNull } =
  (await load("src/lib/public-api/mappers.ts")) as {
    htmlToPlainText: (html: string) => string;
    httpUrlOrNull: (value: string | null) => string | null;
  };
const { sanitizeRichText: appSanitize } = (await load(
  "src/lib/safe-html.ts",
)) as { sanitizeRichText: (html: string) => string };

const tools = new Map<string, ToolHandler>();
registerAtwTools(
  { registerTool: (name, _config, handler) => tools.set(name, handler) },
  {
    origin,
    now: () => DateTime.toDateUtc(now),
    listPublishedEvents: getPublishedEvents,
    getEventBySlug: getExpandedEventBySlug,
    getSpeakerDirectory: () =>
      getSpeakerDirectory(appDb, DateTime.toDateUtc(now)),
    reportError: (error: unknown) => {
      throw error;
    },
  },
);

async function callApp(name: string, args: Record<string, unknown>) {
  const handler = tools.get(name);
  if (handler === undefined) throw new Error(`The app has no ${name} tool.`);
  return handler(args);
}

const layer = Layer.mergeAll(Events.layer, Speakers.layer).pipe(
  Layer.provideMerge(sqlLayer(db)),
  Layer.provideMerge(clockLayer),
);
const runCore = <A, E>(effect: Effect.Effect<A, E, Events | Speakers>) =>
  Effect.runPromise(Effect.provide(effect, layer));

/** A contract value, decoded and encoded again; both sides must be valid. */
const valid = <S extends Schema.Codec<unknown, unknown>>(
  schema: S,
  value: unknown,
) => Schema.encodeSync(schema)(Schema.decodeUnknownSync(schema)(value));

const EventList = Schema.Struct({
  events: Schema.Array(Contract.EventSummary),
});
const SpeakerList = Schema.Struct({ speakers: Schema.Array(Contract.Speaker) });

const canonical = <A>(values: ReadonlyArray<A>): Array<A> =>
  values
    .map((value) => [JSON.stringify(value), value] as const)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, value]) => value);

/**
 * The app reads an event's talks, their speakers and its hosts without ORDER
 * BY, so their order is the query planner's (here: the talks' storage order).
 * Core lists them in the order they were attached, which tests/repositories
 * pins down; parity compares them regardless of order.
 */
const ignoringAttachOrder = (event: Contract.Event): Contract.Event => ({
  ...event,
  talks: canonical(
    event.talks.map((talk) => ({
      ...talk,
      speakers: canonical(talk.speakers),
    })),
  ),
  hosts: canonical(event.hosts),
});

afterAll(() => db.close());

describe("core answers as the app's MCP tools do", () => {
  test.each(["upcoming", "past", "all"] as const)(
    "list_events when=%s",
    async (when) => {
      const appResult = await callApp("list_events", { when, limit: 100 });
      const summaries = await runCore(
        Events.use((events) => events.listPublished).pipe(
          Effect.map((rows) =>
            Mappers.selectEvents(rows, when, now).map((row) =>
              Mappers.toEventSummary(row, origin, now),
            ),
          ),
        ),
      );
      expect(summaries.length).toBeGreaterThan(0);
      expect(valid(EventList, { events: summaries })).toEqual(
        valid(EventList, appResult.structuredContent),
      );
    },
  );

  test("list_events honors the limit the same way", async () => {
    const appResult = await callApp("list_events", { when: "all", limit: 2 });
    const rows = await runCore(Events.use((events) => events.listPublished));
    const events = Mappers.selectEvents(rows, "all", now)
      .slice(0, 2)
      .map((row) => Mappers.toEventSummary(row, origin, now));
    expect(valid(EventList, { events })).toEqual(
      valid(EventList, appResult.structuredContent),
    );
  });

  const slugs = [
    "2026-08-12-react-at-acme",
    "2026-10-03-hack-day",
    "2026-11-05-upcoming",
    "2026-10-03-ends-now",
    "2025-12-02-café-night",
  ];

  test.each(slugs)("get_event %s", async (slug) => {
    const appResult = await callApp("get_event", { slug });
    expect(appResult.isError).toBeUndefined();
    const event = await runCore(
      Events.use((events) => events.getPublished(slug)).pipe(
        Effect.map((row) =>
          valid(Contract.Event, Mappers.toEvent(row, origin, now)),
        ),
      ),
    );
    expect(ignoringAttachOrder(event)).toEqual(
      ignoringAttachOrder(valid(Contract.Event, appResult.structuredContent)),
    );
  });

  test.each([
    "2026-09-01-draft-night",
    "no-such-event",
    "2026-08-12-REACT-AT-ACME",
  ])("get_event %s is not found, with the same message", async (slug) => {
    const appResult = await callApp("get_event", { slug });
    const error = await runCore(
      Effect.flip(Events.use((events) => events.getPublished(slug))),
    );
    expect(error).toBeInstanceOf(EventNotFound);
    expect(appResult.isError).toBe(true);
    expect(appResult.content.map((part) => part.text)).toEqual([error.message]);
  });

  test("list_speakers", async () => {
    const appResult = await callApp("list_speakers", { limit: 200 });
    const coreSpeakers = await runCore(
      Speakers.use((speakers) => speakers.directory).pipe(
        Effect.map((directory) => Mappers.toSpeakers(directory, origin)),
      ),
    );
    expect(coreSpeakers.length).toBeGreaterThan(0);
    expect(valid(SpeakerList, { speakers: coreSpeakers })).toEqual(
      valid(SpeakerList, appResult.structuredContent),
    );
  });
});

describe("core's helpers agree with the app's", () => {
  test.each([
    "<p>One</p><p>Two</p>",
    "<P CLASS=x>Upper<BR>case</P>",
    "<ul><li>a<ul><li>nested</li></ul></li><li>b</li></ul>",
    "<ol><li>first</li></ol><blockquote>quote</blockquote><pre>  code  </pre>",
    "<p>a&nbsp;b &amp; c &lt;d&gt; &quot;e&quot; &#39;f&#39; &eacute; &#x1F600;</p>",
    "<p>&amp;lt;not a tag&amp;gt; &amp;nbsp;</p>",
    "<p>unclosed<p>paragraphs<li>stray item",
    "<script>alert(1)</script><style>p{}</style><textarea>t</textarea><noscript>n</noscript>",
    "<xmp><b>raw</b></xmp><iframe src=x></iframe><!-- comment --><![CDATA[data]]>",
    '<a href="javascript:x" onclick="y">link</a> <img src=x onerror=alert(1)>',
    "<h2>Heading</h2>text   \t\n\n\n\nmore",
    "plain < text > with & stray marks",
    "",
  ])("rich text %j", (html) => {
    expect(htmlToPlainText(sanitizeRichText(html))).toBe(
      appPlainText(appSanitize(html)),
    );
  });

  test.each([
    null,
    "",
    "not a url",
    "javascript:alert(1)",
    "HTTPS://YouTube.com/a b",
    "https://www.youtube.com/watch?v=abc",
    "https://lu.ma/event/evt with space",
  ])("URL %j", (value) => {
    expect(Mappers.httpUrlOrNull(value)).toBe(appHttpUrlOrNull(value));
  });
});
