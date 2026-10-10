import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { Cause, Effect, Exit, Layer } from "effect";
import { approvalToken } from "../src/approval.ts";
import type { EventRef } from "../src/luma/publish.ts";
import {
  questionId,
  questionsInOrder,
  type Registration,
  type RegistrationRequest,
  registrationPlan,
  Registrations,
  requestProblem,
} from "../src/luma/registration.ts";
import { LumaWrite } from "../src/luma/write.ts";
import { seededDatabase, sqlLayer } from "./support/database.ts";
import { configFrom, fakeLumaBy, type Reply, settle } from "./support/luma.ts";

/**
 * An evening's registration on Luma (src/luma/registration.ts): the plan is
 * a pure diff, approving sends exactly that plan and checks it took, and
 * what Luma's API can't set is refused by name. Against a fake Luma that
 * answers as public-api.luma.com/openapi.json documents; nothing here
 * reaches Luma.
 */

const key = "test-luma-key";
const lumaEventId = "evt-madeUp1";
const draft: EventRef = { _tag: "Luma", lumaEventId };

/** events/get as the manager sees it, with registration. */
const eventNow = {
  id: lumaEventId,
  access: "manage",
  name: "All Things Made Up",
  start_at: "2026-10-28T01:00:00.000Z",
  end_at: "2026-10-28T04:30:00.000Z",
  timezone: "America/Los_Angeles",
  url: "https://luma.com/made-up",
  visibility: "private",
  cover_url: null,
  require_approval: false,
  waitlist_status: "disabled",
  max_capacity: 100,
  registration_questions: [
    {
      id: "q-team",
      label: "Your team?",
      required: true,
      question_type: "text",
      multiline: false,
    },
  ],
};

const tickets = {
  entries: [
    {
      id: "ttype-standard",
      name: "Standard",
      require_approval: false,
      is_hidden: false,
      type: "free",
    },
    {
      id: "ttype-hosts",
      name: "Hosts",
      require_approval: true,
      is_hidden: true,
      type: "free",
    },
  ],
};

const json = (value: unknown): Reply => ({ body: JSON.stringify(value) });

/** The registration `eventNow` and `tickets` say. */
const now: Registration = {
  lumaEventId,
  name: "All Things Made Up",
  url: "https://luma.com/made-up",
  visibility: "private",
  approval: false,
  waitlist: false,
  capacity: 100,
  questions: [
    { id: "q-team", label: "Your team?", required: true, type: "text" },
  ],
  tickets: [
    {
      id: "ttype-standard",
      name: "Standard",
      requireApproval: false,
      hidden: false,
    },
    { id: "ttype-hosts", name: "Hosts", requireApproval: true, hidden: true },
  ],
};

let db: PGlite;
beforeAll(async () => {
  db = await seededDatabase();
});
afterAll(() => db.close());

const run = async <A, E>(
  f: (registrations: Registrations["Service"]) => Effect.Effect<A, E>,
  replies: Record<string, ReadonlyArray<Reply>>,
) => {
  const luma = fakeLumaBy((url) => url.pathname, replies);
  const layer = Registrations.layer.pipe(
    Layer.provide(LumaWrite.layer),
    Layer.provide(
      Layer.mergeAll(luma.layer, configFrom({ LUMA_API_KEY: key })),
    ),
    Layer.provide(sqlLayer(db)),
  );
  const exit = await Effect.runPromiseExit(
    settle(Registrations.use(f)).pipe(Effect.provide(layer)),
  );
  return { exit, requests: luma.requests };
};

const message = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) throw new Error("expected a failure");
  const error = Cause.squash(exit.cause);
  return error instanceof Error ? error.message : String(error);
};

const value = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
  return exit.value;
};

const paths = (requests: ReadonlyArray<{ method: string; url: string }>) =>
  requests.map((r) => `${r.method} ${new URL(r.url).pathname}`);

describe("the plan", () => {
  test("is a pure diff: each change from what to what, nothing for what is already so", () => {
    expect(
      registrationPlan(now, {
        approval: true,
        waitlist: true,
        capacity: null,
        questions: [
          { label: "Your team?", required: false },
          { label: " Anything we should know? ", required: false },
        ],
      }),
    ).toEqual({
      changes: [
        // Only the ticket type that differs is set.
        {
          field: "approval",
          from: false,
          to: true,
          ticketTypes: ["ttype-standard"],
        },
        { field: "waitlist", from: false, to: true },
        { field: "capacity", from: 100, to: null },
        {
          field: "questions",
          from: now.questions,
          to: [
            // A question already asked keeps its id.
            {
              id: "q-team",
              label: "Your team?",
              required: false,
              type: "text",
            },
            {
              id: questionId("Anything we should know?"),
              label: "Anything we should know?",
              required: false,
              type: "text",
            },
          ],
        },
      ],
      gaps: [],
    });
    expect(
      registrationPlan(now, {
        waitlist: false,
        capacity: 100,
        questions: [{ label: "Your team?", required: true }],
      }),
    ).toEqual({ changes: [], gaps: [] });
    // The same label always gets the same new id.
    expect(questionId("Anything?")).toBe(questionId("Anything?"));
    // In the shape Luma gives its own questions, e.g. "sqbwk30x".
    expect(questionId("Anything?")).toMatch(/^[a-z0-9]{8}$/);
    expect(questionId("Anything?")).not.toBe(questionId("Anything else?"));
    // A hash short in base 36 is padded to eight.
    expect(questionId("padding-1370")).toBe("0g6mpcml");
  });

  test("names what Luma's API can't set as asked, and plans nothing for it", () => {
    expect(
      registrationPlan({ ...now, tickets: [] }, { approval: true }),
    ).toEqual({
      changes: [],
      gaps: [
        {
          field: "approval",
          reason:
            "Luma keeps approval on ticket types (ticket-types/update), and this event has none to set it on.",
        },
      ],
    });
    const withCompany: Registration = {
      ...now,
      questions: [
        ...now.questions,
        { id: "q-co", label: "Company", required: false, type: "company" },
      ],
    };
    expect(
      registrationPlan(withCompany, {
        capacity: 120,
        questions: [{ label: "Your team?", required: true }],
      }),
    ).toEqual({
      changes: [{ field: "capacity", from: 100, to: 120 }],
      gaps: [
        {
          field: "questions",
          reason:
            "Luma's API writes an event's questions all at once, and the studio writes text questions only. This event also has a company question, \"Company\": remove it on Luma, or leave the questions as they are.",
        },
      ],
    });
  });

  test("an event Luma reads as otherwise than its ticket types say is a gap", () => {
    expect(
      registrationPlan(
        {
          ...now,
          approval: true,
          tickets: now.tickets.map((ticket) => ({
            ...ticket,
            requireApproval: false,
          })),
        },
        { approval: false },
      ),
    ).toEqual({
      changes: [],
      gaps: [
        {
          field: "approval",
          reason:
            "Every ticket type already has approval off, yet Luma reads the event as on: it counts only the ticket types on sale now, which its API can't change from here.",
        },
      ],
    });
  });

  test("a request with nothing in it, a capacity that isn't one, or a question twice is refused", () => {
    expect(requestProblem({ capacity: Number.MAX_SAFE_INTEGER + 2 })).toBe(
      `A capacity is a whole number above 0, or none: ${Number.MAX_SAFE_INTEGER + 2}`,
    );
    expect(requestProblem({})).toBe(
      "Nothing to change: give --approval, --waitlist, --capacity or questions.",
    );
    expect(requestProblem({ capacity: 0 })).toBe(
      "A capacity is a whole number above 0, or none: 0",
    );
    expect(
      requestProblem({
        questions: [
          { label: "Team?", required: true },
          { label: " Team? ", required: false },
        ],
      }),
    ).toBe('A question is asked twice: "Team?"');
    expect(requestProblem({ capacity: null, questions: [] })).toBeNull();
  });

  test("questions keep the order they were given in, across both flags", () => {
    expect(
      questionsInOrder([
        "luma",
        "registration",
        "--question-optional",
        "First?",
        "--capacity",
        "120",
        "--question=Second = yes?",
        "--question-optional=Third?",
        "--",
        "--question",
        "not a flag",
      ]),
    ).toEqual([
      { label: "First?", required: false },
      { label: "Second = yes?", required: true },
      { label: "Third?", required: false },
    ]);
  });
});

describe("prepare", () => {
  test("reads registration, sends nothing, and prints the token for exactly the plan", async () => {
    const request = { approval: true, capacity: 120 } as const;
    const { exit, requests } = await run((r) => r.prepare(draft, request), {
      "/v1/events/get": [json(eventNow)],
      "/v1/events/ticket-types/list": [json(tickets)],
    });
    const prepared = value(exit);
    expect(prepared.registration).toEqual(now);
    expect(prepared.changes).toEqual(registrationPlan(now, request).changes);
    expect(prepared.public).toBe(false);
    expect(prepared.token).toBe(
      await Effect.runPromise(
        approvalToken({
          lumaEventId,
          visibility: "private",
          registration: now,
          changes: prepared.changes,
        }),
      ),
    );
    expect(paths(requests)).toEqual([
      "GET /v1/events/get",
      "GET /v1/events/ticket-types/list",
    ]);
    expect(
      new URL(requests[1]?.url ?? "").searchParams.get("include_hidden"),
    ).toBe("true");
  });

  test("finds an evening by its slug, and says a public one's change reaches guests", async () => {
    const { exit } = await run(
      (r) =>
        r.prepare(
          { _tag: "Slug", slug: "2026-09-01-draft-night" },
          { capacity: 60 },
        ),
      {
        "/v1/events/get": [
          json({ ...eventNow, id: "evt-draft", visibility: "public" }),
        ],
        "/v1/events/ticket-types/list": [json(tickets)],
      },
    );
    const prepared = value(exit);
    expect(prepared.registration.lumaEventId).toBe("evt-draft");
    expect(prepared.public).toBe(true);
  });
});

describe("approve", () => {
  const request = {
    approval: true,
    waitlist: true,
    capacity: 120,
    questions: [
      { label: "Your team?", required: true },
      { label: "Anything we should know?", required: false },
    ],
  } as const;

  const eventAfter = {
    ...eventNow,
    require_approval: true,
    waitlist_status: "enabled",
    max_capacity: 120,
    registration_questions: [
      eventNow.registration_questions[0],
      {
        id: questionId("Anything we should know?"),
        label: "Anything we should know?",
        required: false,
        question_type: "text",
      },
    ],
  };
  const ticketsAfter = {
    entries: tickets.entries.map((ticket) => ({
      ...ticket,
      require_approval: true,
    })),
  };

  const tokenFor = async (asked: RegistrationRequest = request) =>
    value(
      (
        await run((r) => r.prepare(draft, asked), {
          "/v1/events/get": [json(eventNow)],
          "/v1/events/ticket-types/list": [json(tickets)],
        })
      ).exit,
    ).token;

  test("sends exactly the plan the dry run printed, and checks it took", async () => {
    // The evening is stored, so the change has its line in the draft's log.
    await db.exec(
      `UPDATE events SET luma_event_id = '${lumaEventId}' WHERE slug = '2026-09-01-draft-night'`,
    );
    const token = await tokenFor();
    const { exit, requests } = await run(
      (r) => r.approve(draft, request, token),
      {
        "/v1/events/get": [json(eventNow), json(eventAfter)],
        "/v1/events/ticket-types/list": [json(tickets), json(ticketsAfter)],
        "/v1/events/ticket-types/update": [json({})],
        "/v1/events/update": [json({})],
      },
    );
    const made = value(exit);
    expect(made.token).toBe(token);
    expect(paths(requests)).toEqual([
      "GET /v1/events/get",
      "GET /v1/events/ticket-types/list",
      "POST /v1/events/ticket-types/update",
      "POST /v1/events/update",
      "GET /v1/events/get",
      "GET /v1/events/ticket-types/list",
    ]);
    expect(JSON.parse(requests[2]?.body ?? "")).toEqual({
      event_ticket_type_id: "ttype-standard",
      require_approval: true,
    });
    expect(JSON.parse(requests[3]?.body ?? "")).toEqual({
      event_id: lumaEventId,
      waitlist_status: "enabled",
      max_capacity: 120,
      registration_questions: [
        // What Luma had on a question it keeps is sent back as it was.
        {
          id: "q-team",
          label: "Your team?",
          required: true,
          question_type: "text",
          multiline: false,
        },
        {
          id: questionId("Anything we should know?"),
          label: "Anything we should know?",
          required: false,
          question_type: "text",
        },
      ],
    });
    // Its line says what changed: never an email, nor the approval token.
    const { rows: lines } = await db.query<{
      command: string;
      summary: string;
      payload: unknown;
    }>(`SELECT command, summary, payload FROM planning.draft_log`);
    expect(lines).toEqual([
      {
        command: "luma registration",
        summary:
          "Set its registration on Luma: approval, waitlist, capacity, questions.",
        payload: { fields: ["approval", "waitlist", "capacity", "questions"] },
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain("@");
    expect(JSON.stringify(lines)).not.toContain(token);
  });

  test("says what went through when a write fails part way", async () => {
    const token = await tokenFor();
    const { exit, requests } = await run(
      (r) => r.approve(draft, request, token),
      {
        "/v1/events/get": [json(eventNow)],
        "/v1/events/ticket-types/list": [json(tickets)],
        "/v1/events/ticket-types/update": [json({})],
        "/v1/events/update": [{ status: 400, body: "{}" }],
      },
    );
    expect(message(exit)).toStartWith(
      "Luma refused or didn't answer the event update (waitlist_status, max_capacity, registration_questions)",
    );
    expect(message(exit)).toEndWith(
      "These went through before it: approval on on ticket type ttype-standard. Read it with bun run luma registration before setting it again.",
    );
    // Nothing is read back or tried again after a failed write.
    expect(paths(requests).at(-1)).toBe("POST /v1/events/update");
  });

  test("refuses a token for any other plan, and sends nothing", async () => {
    const token = await tokenFor({ ...request, capacity: 200 });
    const { exit, requests } = await run(
      (r) => r.approve(draft, request, token),
      {
        "/v1/events/get": [json(eventNow)],
        "/v1/events/ticket-types/list": [json(tickets)],
      },
    );
    expect(message(exit)).toStartWith(
      `What would change has changed since ${token} was approved`,
    );
    expect(requests.some((r) => r.method !== "GET")).toBe(false);
  });

  test("refuses what Luma's API can't set, by name, and sends nothing", async () => {
    const asked = { approval: true, capacity: 120 } as const;
    const replies = {
      "/v1/events/get": [json(eventNow)],
      "/v1/events/ticket-types/list": [json({ entries: [] })],
    };
    const prepared = value(
      (await run((r) => r.prepare(draft, asked), replies)).exit,
    );
    expect(prepared.gaps.map((gap) => gap.field)).toEqual(["approval"]);
    const { exit, requests } = await run(
      (r) => r.approve(draft, asked, prepared.token),
      replies,
    );
    expect(message(exit)).toBe(
      "Luma's API can't set this as asked, so nothing was sent: approval: Luma keeps approval on ticket types (ticket-types/update), and this event has none to set it on.",
    );
    expect(requests.some((r) => r.method !== "GET")).toBe(false);
  });

  test("says which changes Luma didn't take", async () => {
    const token = await tokenFor();
    const { exit } = await run((r) => r.approve(draft, request, token), {
      "/v1/events/get": [
        json(eventNow),
        json({ ...eventAfter, waitlist_status: "disabled" }),
      ],
      "/v1/events/ticket-types/list": [json(tickets), json(ticketsAfter)],
      "/v1/events/ticket-types/update": [json({})],
      "/v1/events/update": [json({})],
    });
    expect(message(exit)).toBe(
      "Luma took the changes, but these don't read as sent: waitlist. Read it with bun run luma registration and set it again.",
    );
  });

  test("refuses an event Luma answers about without its registration", async () => {
    const { registration_questions: _gone, ...bare } = eventNow;
    const { exit } = await run((r) => r.read(draft), {
      "/v1/events/get": [json(bare)],
      "/v1/events/ticket-types/list": [json(tickets)],
    });
    expect(message(exit)).toBe(
      "Luma's answer to events/get has no registration_questions: it is not what its API documents.",
    );
  });
});
