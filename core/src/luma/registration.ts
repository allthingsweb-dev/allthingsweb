import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { approvalToken } from "../approval.ts";
import { DataSourceError } from "../errors.ts";
import { type EventRef, StudioRefused } from "./publish.ts";
import {
  LumaWrite,
  type LumaWriteError,
  type LumaEventFields,
  type LumaQuestion,
  type LumaTicketType,
  type ManagedEvent,
} from "./write.ts";

/**
 * An evening's registration on Luma: whether registering needs an
 * organizer's approval, whether a full event takes a waitlist, how many
 * guests it takes, and the questions it asks, in order. Read at any time;
 * changed in two steps, as publishing and covers are.
 *
 * What Luma's API can set (public-api.luma.com/openapi.json):
 *
 * - **capacity**: `max_capacity` on `events/update`, a number or null for
 *   no limit.
 * - **waitlist**: `waitlist_status` on `events/update`, enabled or disabled.
 * - **questions**: `registration_questions` on `events/update`, the whole
 *   list at once. The studio writes text questions only: a question of
 *   another type (company, select, terms and the rest) carries settings it
 *   can't write back, so an event that has one is refused, by name.
 * - **approval**: no field on the event says it. `require_approval` there is
 *   read-only, true when any ticket type that's on sale requires approval.
 *   Luma keeps it on each ticket type (`ticket-types/update`), so approval
 *   is set on every ticket type, hidden ones too. An event with no ticket
 *   types is refused, by name.
 *
 * Whatever can't be set as asked is a gap, refused with its reason, never
 * skipped.
 *
 * - `read` says how registration is now.
 * - `prepare` says each change from what to what, any gaps, and the
 *   approval token for exactly that: the first 16 hex digits of the
 *   SHA-256 of the event, how its registration is now, and the changes, as
 *   canonical JSON. A public event's change reaches guests at once, which
 *   the plan says.
 * - `approve` takes that token, works the plan out again and goes on only
 *   if it hashes the same. It sets approval on the ticket types that
 *   differ, sends one event update with the rest, and reads registration
 *   back to check each change took.
 */

/** A question to ask, as an organizer writes it: a text field. */
export const QuestionInput = Schema.Struct({
  label: Schema.String,
  required: Schema.Boolean,
});
export type QuestionInput = typeof QuestionInput.Type;

/** What an organizer asks to set; whatever is left out stays as it is. */
export interface RegistrationRequest {
  readonly approval?: boolean;
  readonly waitlist?: boolean;
  /** Most guests; null for no limit. */
  readonly capacity?: number | null;
  /** The whole list, in order; [] for none. */
  readonly questions?: ReadonlyArray<QuestionInput>;
}

/** A question as Luma has it. */
export interface Question {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  readonly type: string;
}

/** An evening's registration, as Luma has it now. */
export interface Registration {
  readonly lumaEventId: string;
  readonly name: string;
  readonly url: string;
  readonly visibility: ManagedEvent["visibility"];
  readonly approval: boolean;
  readonly waitlist: boolean;
  readonly capacity: number | null;
  readonly questions: ReadonlyArray<Question>;
  readonly tickets: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly requireApproval: boolean;
    readonly hidden: boolean;
  }>;
}

/** One change the plan makes. */
export type RegistrationChange =
  | {
      readonly field: "approval";
      readonly from: boolean;
      readonly to: boolean;
      /** The ticket types it is set on: those that differ. */
      readonly ticketTypes: ReadonlyArray<string>;
    }
  | { readonly field: "waitlist"; readonly from: boolean; readonly to: boolean }
  | {
      readonly field: "capacity";
      readonly from: number | null;
      readonly to: number | null;
    }
  | {
      readonly field: "questions";
      readonly from: ReadonlyArray<Question>;
      readonly to: ReadonlyArray<Question>;
    };

/** What a gap is about: a setting, as the command names it. */
export type RegistrationField = RegistrationChange["field"];

/** A setting Luma's API can't make as asked: refused, never skipped. */
export interface RegistrationGap {
  readonly field: RegistrationField;
  readonly reason: string;
}

export interface RegistrationPlan {
  readonly changes: ReadonlyArray<RegistrationChange>;
  readonly gaps: ReadonlyArray<RegistrationGap>;
}

export interface PreparedRegistration extends RegistrationPlan {
  readonly registration: Registration;
  /** True when the event is public: a change reaches guests at once. */
  readonly public: boolean;
  readonly token: string;
}

export type RegistrationFailure =
  | StudioRefused
  | LumaWriteError
  | DataSourceError;

export interface RegistrationShape {
  readonly read: (
    ref: EventRef,
  ) => Effect.Effect<Registration, RegistrationFailure>;
  readonly prepare: (
    ref: EventRef,
    request: RegistrationRequest,
  ) => Effect.Effect<PreparedRegistration, RegistrationFailure>;
  readonly approve: (
    ref: EventRef,
    request: RegistrationRequest,
    token: string,
  ) => Effect.Effect<PreparedRegistration, RegistrationFailure>;
}

const refuse = (reason: string) => Effect.fail(new StudioRefused({ reason }));

/** The longest question label the studio writes. */
const labelLimit = 200;

/** Why `request` can't be asked at all, before anything is read; null when it can. */
export function requestProblem(request: RegistrationRequest): string | null {
  const keys = (
    ["approval", "waitlist", "capacity", "questions"] as const
  ).filter((key) => request[key] !== undefined);
  if (keys.length === 0) {
    return "Nothing to change: give --approval, --waitlist, --capacity or questions.";
  }
  const capacity = request.capacity;
  if (
    capacity !== undefined &&
    capacity !== null &&
    !(Number.isSafeInteger(capacity) && capacity > 0)
  ) {
    return `A capacity is a whole number above 0, or none: ${capacity}`;
  }
  const seen = new Set<string>();
  for (const question of request.questions ?? []) {
    const label = question.label.trim();
    if (label === "" || Array.from(label).length > labelLimit) {
      return `A question is 1 to ${labelLimit} characters: "${question.label}"`;
    }
    if (seen.has(label)) return `A question is asked twice: "${label}"`;
    seen.add(label);
  }
  return null;
}

/**
 * A new question's id, in the shape Luma gives its own: eight lowercase
 * letters and digits (as `events/get` answers, e.g. "sqbwk30x"). Luma's
 * API takes the id from us (`registration_questions[].id` is required);
 * its own shape is the one sure to be taken. The same label always gets
 * the same one, so a plan read twice is the same plan. A question already
 * asked keeps its own.
 */
export const questionId = (label: string): string => {
  const hash = new Bun.CryptoHasher("sha256").update(label).digest("hex");
  // 48 bits in base 36 are 10 characters at most, so 8 are always there.
  return BigInt(`0x${hash.slice(0, 12)}`)
    .toString(36)
    .padStart(8, "0")
    .slice(-8);
};

/** The changes `request` makes to `current`, and what Luma can't do: no reads, no writes. */
export function registrationPlan(
  current: Registration,
  request: RegistrationRequest,
): RegistrationPlan {
  const changes: Array<RegistrationChange> = [];
  const gaps: Array<RegistrationGap> = [];

  if (request.approval !== undefined) {
    const to = request.approval;
    if (current.tickets.length === 0) {
      gaps.push({
        field: "approval",
        reason:
          "Luma keeps approval on ticket types (ticket-types/update), and this event has none to set it on.",
      });
    } else {
      const differ = current.tickets.filter(
        (ticket) => ticket.requireApproval !== to,
      );
      if (differ.length === 0 && current.approval !== to) {
        gaps.push({
          field: "approval",
          reason: `Every ticket type already has approval ${to ? "on" : "off"}, yet Luma reads the event as ${current.approval ? "on" : "off"}: it counts only the ticket types on sale now, which its API can't change from here.`,
        });
      } else if (differ.length > 0) {
        changes.push({
          field: "approval",
          from: current.approval,
          to,
          ticketTypes: differ.map((ticket) => ticket.id),
        });
      }
    }
  }
  if (request.waitlist !== undefined && request.waitlist !== current.waitlist) {
    changes.push({
      field: "waitlist",
      from: current.waitlist,
      to: request.waitlist,
    });
  }
  if (request.capacity !== undefined && request.capacity !== current.capacity) {
    changes.push({
      field: "capacity",
      from: current.capacity,
      to: request.capacity,
    });
  }
  if (request.questions !== undefined) {
    const unwritable = current.questions.filter(
      (question) => question.type !== "text",
    );
    if (unwritable.length > 0) {
      gaps.push({
        field: "questions",
        reason: `Luma's API writes an event's questions all at once, and the studio writes text questions only. This event also has ${unwritable
          .map((question) => `a ${question.type} question, "${question.label}"`)
          .join(", ")}: remove it on Luma, or leave the questions as they are.`,
      });
    } else {
      const to = request.questions.map((question): Question => {
        const label = question.label.trim();
        const asked = current.questions.find((own) => own.label === label);
        return {
          id: asked?.id ?? questionId(label),
          label,
          required: question.required,
          type: "text",
        };
      });
      const same =
        to.length === current.questions.length &&
        to.every((question, index) => {
          const own = current.questions[index];
          return (
            own !== undefined &&
            own.label === question.label &&
            own.required === question.required
          );
        });
      if (!same) {
        changes.push({ field: "questions", from: current.questions, to });
      }
    }
  }
  return { changes, gaps };
}

/** Registration as `event` and its ticket types say it. */
export function registrationOf(
  event: ManagedEvent,
  tickets: ReadonlyArray<LumaTicketType>,
): Registration | string {
  const missing = (
    [
      "require_approval",
      "waitlist_status",
      "max_capacity",
      "registration_questions",
    ] as const
  ).filter((field) => event[field] === undefined);
  if (missing.length > 0) {
    return `Luma's answer to events/get has no ${missing.join(", ")}: it is not what its API documents.`;
  }
  return {
    lumaEventId: event.id,
    name: event.name,
    url: event.url,
    visibility: event.visibility,
    approval: event.require_approval === true,
    waitlist: event.waitlist_status === "enabled",
    capacity: event.max_capacity ?? null,
    questions: (event.registration_questions ?? []).map((question) => ({
      id: question.id,
      label: question.label,
      required: question.required,
      type: question.question_type,
    })),
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      name: ticket.name,
      requireApproval: ticket.require_approval,
      hidden: ticket.is_hidden,
    })),
  };
}

/** Whether `after`, read back, shows `change` made. */
export function took(change: RegistrationChange, after: Registration): boolean {
  if (change.field === "approval") {
    return (
      after.approval === change.to &&
      after.tickets.every(
        (ticket) =>
          !change.ticketTypes.includes(ticket.id) ||
          ticket.requireApproval === change.to,
      )
    );
  }
  if (change.field === "waitlist") return after.waitlist === change.to;
  if (change.field === "capacity") return after.capacity === change.to;
  return (
    after.questions.length === change.to.length &&
    change.to.every((question, index) => {
      const own = after.questions[index];
      return (
        own !== undefined &&
        own.label === question.label &&
        own.required === question.required
      );
    })
  );
}

/** The questions as `events/update` takes them, keeping what Luma had on each. */
const questionsField = (
  to: ReadonlyArray<Question>,
  asked: ReadonlyArray<LumaQuestion>,
): ReadonlyArray<LumaQuestion> =>
  to.map((question) => {
    const own = asked.find((existing) => existing.id === question.id);
    return {
      ...own,
      id: question.id,
      label: question.label,
      required: question.required,
      question_type: "text",
    };
  });

const Row = Schema.Struct({
  slug: Schema.String,
  lumaEventId: Schema.NullOr(Schema.String),
  curation: Schema.String,
});

const make = Effect.gen(function* () {
  const luma = yield* LumaWrite;
  const sql = yield* SqlClient;

  /** The Luma event `ref` names. */
  const lumaIdOf = (ref: EventRef) =>
    Effect.gen(function* () {
      if (ref._tag === "Luma") return ref.lumaEventId;
      const [row] = yield* sql`
        SELECT slug, luma_event_id AS "lumaEventId", curation
        FROM events WHERE slug = ${ref.slug} OR short_slug = ${ref.slug}`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Row))),
        Effect.mapError((cause) => new DataSourceError({ cause })),
      );
      if (row === undefined) {
        return yield* refuse(`No evening, published or draft, is ${ref.slug}.`);
      }
      if (row.curation === "shared") {
        return yield* refuse(
          `${row.slug} is shared: its registration is its organizer's.`,
        );
      }
      if (row.lumaEventId === null) {
        return yield* refuse(`${row.slug} has no Luma event yet.`);
      }
      return row.lumaEventId;
    });

  const readFrom = (lumaEventId: string) =>
    Effect.gen(function* () {
      const event = yield* luma.get(lumaEventId);
      if (event.access !== "manage") {
        return yield* refuse(
          `${lumaEventId} isn't our calendar's to manage: its registration can't be read or changed.`,
        );
      }
      const tickets = yield* luma.ticketTypes(lumaEventId);
      const registration = registrationOf(event, tickets);
      if (typeof registration === "string") return yield* refuse(registration);
      return { event, registration };
    });

  const prepareFrom = (lumaEventId: string, request: RegistrationRequest) =>
    Effect.gen(function* () {
      const problem = requestProblem(request);
      if (problem !== null) return yield* refuse(problem);
      const { event, registration } = yield* readFrom(lumaEventId);
      const plan = registrationPlan(registration, request);
      const token = yield* approvalToken({
        lumaEventId,
        visibility: registration.visibility,
        registration,
        changes: plan.changes,
      });
      const prepared: PreparedRegistration = {
        ...plan,
        registration,
        public: registration.visibility === "public",
        token,
      };
      return { event, prepared };
    });

  const approve = (
    ref: EventRef,
    request: RegistrationRequest,
    token: string,
  ) =>
    Effect.gen(function* () {
      const lumaEventId = yield* lumaIdOf(ref);
      const { event, prepared } = yield* prepareFrom(lumaEventId, request);
      if (prepared.token !== token) {
        return yield* refuse(
          `What would change has changed since ${token} was approved: it is now ${prepared.token}. Read it again with --dry-run, and approve that.`,
        );
      }
      if (prepared.gaps.length > 0) {
        return yield* refuse(
          `Luma's API can't set this as asked, so nothing was sent: ${prepared.gaps
            .map((gap) => `${gap.field}: ${gap.reason}`)
            .join(" ")}`,
        );
      }
      if (prepared.changes.length === 0) {
        return yield* refuse("Nothing to change: registration is already so.");
      }
      const fields: {
        -readonly [K in keyof LumaEventFields]: LumaEventFields[K];
      } = {};
      // Each write that went through, so a failure part way says what did.
      const done: Array<string> = [];
      const step = (what: string, write: Effect.Effect<void, LumaWriteError>) =>
        write.pipe(
          Effect.tap(() => Effect.sync(() => done.push(what))),
          Effect.catch((failure) =>
            refuse(
              `Luma refused or didn't answer ${what} (${failure.message}). ${
                done.length === 0
                  ? "Nothing before it was sent."
                  : `These went through before it: ${done.join("; ")}.`
              } Read it with bun run luma registration before setting it again.`,
            ),
          ),
        );
      for (const change of prepared.changes) {
        if (change.field === "approval") {
          for (const ticketType of change.ticketTypes) {
            yield* step(
              `approval ${change.to ? "on" : "off"} on ticket type ${ticketType}`,
              luma.setTicketApproval(ticketType, change.to),
            );
          }
        } else if (change.field === "waitlist") {
          fields.waitlist_status = change.to ? "enabled" : "disabled";
        } else if (change.field === "capacity") {
          fields.max_capacity = change.to;
        } else {
          fields.registration_questions = questionsField(
            change.to,
            event.registration_questions ?? [],
          );
        }
      }
      if (Object.keys(fields).length > 0) {
        yield* step(
          `the event update (${Object.keys(fields).join(", ")})`,
          luma.update(lumaEventId, fields),
        );
      }
      const { registration: after } = yield* readFrom(lumaEventId);
      const missed = prepared.changes.filter((change) => !took(change, after));
      if (missed.length > 0) {
        return yield* refuse(
          `Luma took the changes, but these don't read as sent: ${missed
            .map((change) => change.field)
            .join(
              ", ",
            )}. Read it with bun run luma registration and set it again.`,
        );
      }
      return { ...prepared, registration: after };
    });

  return Registrations.of({
    read: (ref) =>
      Effect.flatMap(lumaIdOf(ref), readFrom).pipe(
        Effect.map(({ registration }) => registration),
      ),
    prepare: (ref, request) =>
      Effect.flatMap(lumaIdOf(ref), (lumaEventId) =>
        prepareFrom(lumaEventId, request),
      ).pipe(Effect.map(({ prepared }) => prepared)),
    approve,
  });
});

export class Registrations extends Context.Service<
  Registrations,
  RegistrationShape
>()("allthings/Registrations") {
  /** Needs `LumaWrite` and a `SqlClient`, to find an evening by its slug. */
  static readonly layer = Layer.effect(Registrations, make);
}

/**
 * The questions `args` (a command line) asks, in the order given:
 * `--question <label>` is required, `--question-optional <label>` isn't,
 * each also as `--flag=<label>`. Two repeated flags can't say their order
 * between them, so it is read from the command line itself; nothing after
 * `--` is a flag.
 */
export function questionsInOrder(
  args: ReadonlyArray<string>,
): ReadonlyArray<QuestionInput> {
  const flags = {
    "--question": true,
    "--question-optional": false,
  } as const;
  const questions: Array<QuestionInput> = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") break;
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (name !== "--question" && name !== "--question-optional") continue;
    const label = equals === -1 ? args[++index] : arg.slice(equals + 1);
    if (label === undefined) break;
    questions.push({ label, required: flags[name] });
  }
  return questions;
}
