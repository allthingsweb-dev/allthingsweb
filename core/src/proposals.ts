import { Effect, Result, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { approvalToken, isApprovalToken } from "./approval.ts";
import { currentActor } from "./planning/draft-log.ts";

/**
 * Talks people propose to give at one of our evenings
 * (migrations/0040_proposals.ts): what the talk is, who proposes it and how
 * to reach them, and whether the organizers accepted it.
 *
 * - **Reading one in** (`readProposal`): a proposal as anyone sends it, from
 *   a form, a tool or a flag, held to the same limits as the table, with
 *   each problem said per field in words a person can act on. Strings are
 *   trimmed and line endings made `\n` first.
 * - **Recording one** (`recordProposal`): an organizer stores a proposal
 *   sent to them by email or a message, as ALLTHINGS_ACTOR.
 * - **Reviewing** (`listProposals`, `getProposal`): the organizers' queue,
 *   oldest first, so nobody waits behind newer ones.
 * - **Deciding** (`planDecision`, `decide`): accepting, declining or
 *   removing one, exactly as a dry run showed it. The dry run prints the
 *   proposal, the decision and an approval token, the hash of both; the
 *   approved run locks the row, works it out again and refuses unless it
 *   still hashes to the token, so a proposal changed or decided in between
 *   stops it. Removing deletes the row: spam, a test, or someone asking to
 *   be forgotten.
 *
 * Every row is private: it runs as the studio (or the owner), never as a
 * site role, and nothing public ever shows a proposal.
 */

export class ProposalError extends Schema.TaggedError<ProposalError>()(
  "ProposalError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

const refuse = (reason: string) => Effect.fail(new ProposalError({ reason }));

/** What kind of slot the talk wants. */
export const ProposalFormat = Schema.Literals(["talk", "lightning", "demo"]);
export type ProposalFormat = typeof ProposalFormat.Type;

/** How long each format runs, as the form and the tools say it. */
export const formatLabels: Readonly<Record<ProposalFormat, string>> = {
  talk: "a talk, about 20 minutes",
  lightning: "a lightning talk, about 5 minutes",
  demo: "a demo, about 10 minutes",
};

/** Where a proposal came from. */
export const ProposalSource = Schema.Literals([
  "site",
  "mcp",
  "cli",
  "api",
  "organizer",
]);
export type ProposalSource = typeof ProposalSource.Type;

export const ProposalStatus = Schema.Literals(["new", "accepted", "declined"]);
export type ProposalStatus = typeof ProposalStatus.Type;

/** The limits each field is held to, here and by the table's CHECKs. */
export const proposalLimits = {
  title: 120,
  abstractMin: 40,
  abstract: 2000,
  name: 100,
  email: 254,
  about: 1000,
  links: 4,
  link: 255,
  notes: 1000,
  decisionNote: 1000,
} as const;

/**
 * Control characters but a tab and a line break, and Unicode's line and
 * paragraph separators: what doesn't read as it looks.
 */
const unreadable = (value: string): boolean => {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if ((code < 0x20 && char !== "\t" && char !== "\n") || code === 0x7f) {
      return true;
    }
    if (code === 0x2028 || code === 0x2029) return true;
  }
  return false;
};

/** One line of text, from 1 to `max` characters, saying `what` when it isn't. */
const line = (max: number, what: string) =>
  Schema.String.check(
    Schema.makeFilter((value: string) =>
      value === ""
        ? `${what} is missing.`
        : unreadable(value)
          ? `${what} has a character in it that isn't text.`
          : value.length > max
            ? `${what} is ${value.length} characters; keep it to ${max}.`
            : value.includes("\n")
              ? `${what} fits on one line.`
              : undefined,
    ),
  );

/** Text of `min` to `max` characters, lines allowed. */
const text = (min: number, max: number, what: string) =>
  Schema.String.check(
    Schema.makeFilter((value: string) =>
      value === ""
        ? `${what} is missing.`
        : unreadable(value)
          ? `${what} has a character in it that isn't text.`
          : value.length < min
            ? `${what} is ${value.length} characters; say a little more, at least ${min}.`
            : value.length > max
              ? `${what} is ${value.length} characters; keep it to ${max}.`
              : undefined,
    ),
  );

/** An email address, as proposals_email_check reads one. */
const Email = Schema.String.check(
  Schema.makeFilter((value: string) =>
    value === ""
      ? "An email is missing: it is how we answer you."
      : value.length <= proposalLimits.email &&
          !unreadable(value) &&
          /^[^@\s]+@[^@\s]+[.][^@\s]+$/.test(value)
        ? undefined
        : `${JSON.stringify(value.slice(0, 60))} doesn't read as an email address.`,
  ),
);

/** What is wrong with `value` as a link, if anything: https, at most proposalLimits.link characters. */
const linkProblem = (value: string): string | undefined => {
  const shown = JSON.stringify(value.slice(0, 60));
  if (!/^https:\/\/\S+$/.test(value) || URL.parse(value) === null) {
    return `${shown} isn't an https:// link.`;
  }
  return value.length <= proposalLimits.link
    ? undefined
    : `A link is ${value.length} characters; keep each to ${proposalLimits.link}.`;
};

/** Up to proposalLimits.links different https links. */
const Links = Schema.Array(Schema.String).check(
  Schema.makeFilter((links: ReadonlyArray<string>) =>
    links.length > proposalLimits.links
      ? `${links.length} links; give at most ${proposalLimits.links}.`
      : new Set(links).size === links.length
        ? links.map(linkProblem).find((problem) => problem !== undefined)
        : "A link is given twice.",
  ),
);

/** Each field a proposal takes, with the schema it is held to. */
const fieldSchemas = {
  title: line(proposalLimits.title, "The title"),
  abstract: text(
    proposalLimits.abstractMin,
    proposalLimits.abstract,
    "The abstract",
  ),
  format: ProposalFormat.annotate({
    message: `The format is one of ${ProposalFormat.literals.join(", ")}.`,
  }),
  name: line(proposalLimits.name, "Your name"),
  email: Email,
  about: text(1, proposalLimits.about, "About you"),
  links: Links,
  notes: text(1, proposalLimits.notes, "The notes"),
} as const;

export type ProposalField = keyof typeof fieldSchemas;

/** The fields a proposal must have. */
const requiredFields: ReadonlyArray<ProposalField> = [
  "title",
  "abstract",
  "name",
  "email",
];

/** A proposal, read in: trimmed, checked, ready to store. */
export interface ProposalInput {
  readonly title: string;
  readonly abstract: string;
  readonly format: ProposalFormat;
  readonly name: string;
  readonly email: string;
  readonly about: string | null;
  readonly links: ReadonlyArray<string>;
  readonly notes: string | null;
}

/** What is wrong with a proposal as sent, one problem per field. */
export interface ProposalProblem {
  readonly field: ProposalField | "proposal";
  readonly message: string;
}

/** A string trimmed, with `\r\n` and `\r` read as `\n`, in NFC; anything else as it is. */
const tidy = (value: unknown): unknown =>
  typeof value === "string"
    ? value.replaceAll(/\r\n?/g, "\n").normalize("NFC").trim()
    : Array.isArray(value)
      ? value.map(tidy)
      : value;

/**
 * Reads a proposal as anyone sends it: an object with the fields above,
 * nothing else. Each string is tidied first; an optional field that is
 * left out, null or blank is absent, and `links` may be blank strings,
 * which are dropped. Either the proposal, ready to store, or every
 * problem, one per field, in the fields' order.
 */
export function readProposal(
  raw: unknown,
):
  | { readonly ok: true; readonly proposal: ProposalInput }
  | { readonly ok: false; readonly problems: ReadonlyArray<ProposalProblem> } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      problems: [
        { field: "proposal", message: "A proposal is an object of fields." },
      ],
    };
  }
  const fields = raw as Record<string, unknown>;
  const problems: Array<ProposalProblem> = [];
  const extra = Object.keys(fields).filter(
    (key) => !Object.hasOwn(fieldSchemas, key),
  );
  if (extra.length > 0) {
    problems.push({
      field: "proposal",
      message: `Unknown field${extra.length === 1 ? "" : "s"}: ${extra
        .slice(0, 5)
        .map((key) => JSON.stringify(key.slice(0, 40)))
        .join(", ")}.`,
    });
  }
  const read: Partial<Record<ProposalField, unknown>> = {};
  for (const [field, schema] of Object.entries(fieldSchemas) as Array<
    [ProposalField, Schema.Codec<unknown, unknown>]
  >) {
    let value = tidy(fields[field]);
    if (field === "links" && Array.isArray(value)) {
      value = value.filter((link) => link !== "");
    }
    if (value === undefined || value === null || value === "") {
      if (requiredFields.includes(field)) {
        const missing = Schema.decodeUnknownResult(schema)("");
        problems.push({
          field,
          message: Result.isFailure(missing)
            ? messageOf(field, missing.failure)
            : `${field} is missing.`,
        });
      }
      continue;
    }
    const decoded = Schema.decodeUnknownResult(schema)(value);
    if (Result.isSuccess(decoded)) {
      read[field] = decoded.success;
    } else {
      problems.push({ field, message: messageOf(field, decoded.failure) });
    }
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    proposal: {
      title: read.title as string,
      abstract: read.abstract as string,
      format: (read.format as ProposalFormat | undefined) ?? "talk",
      name: read.name as string,
      email: read.email as string,
      about: (read.about as string | undefined) ?? null,
      links: (read.links as ReadonlyArray<string> | undefined) ?? [],
      notes: (read.notes as string | undefined) ?? null,
    },
  };
}

/**
 * A failed decode's message: a filter's own words, which name the field,
 * else Schema's ("Expected string"), after the field's name.
 */
function messageOf(field: ProposalField, error: Schema.SchemaError): string {
  // A filter's message is the last line Schema prints for it.
  const message = error.message
    .split("\n")
    .at(-1)!
    .replace(/^\s*(└─\s*)?/, "");
  return message.startsWith("Expected") ? `${field}: ${message}.` : message;
}

/** A proposal as stored. */
export const Proposal = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  abstract: Schema.String,
  format: ProposalFormat,
  name: Schema.String,
  email: Schema.String,
  about: Schema.NullOr(Schema.String),
  links: Schema.Array(Schema.String),
  notes: Schema.NullOr(Schema.String),
  source: ProposalSource,
  recordedBy: Schema.NullOr(Schema.String),
  status: ProposalStatus,
  decidedAt: Schema.NullOr(Schema.String),
  decidedBy: Schema.NullOr(Schema.String),
  decisionNote: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type Proposal = typeof Proposal.Type;

/** `column`, a timestamptz, as an ISO instant in UTC, whatever the session's time zone. */
const iso = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const proposalJson = `json_build_object(
  'id', p.id, 'title', p.title, 'abstract', p.abstract, 'format', p.format,
  'name', p.name, 'email', p.email, 'about', p.about, 'links', to_json(p.links),
  'notes', p.notes, 'source', p.source, 'recordedBy', p.recorded_by,
  'status', p.status, 'decidedAt', ${iso("p.decided_at")}, 'decidedBy', p.decided_by,
  'decisionNote', p.decision_note,
  'createdAt', ${iso("p.created_at")}, 'updatedAt', ${iso("p.updated_at")}
)`;

const Rows = Schema.Array(Schema.Struct({ proposal: Proposal }));

const decodeRows = (rows: ReadonlyArray<unknown>) =>
  Schema.decodeUnknownEffect(Rows)(rows).pipe(
    Effect.map((decoded) => decoded.map((row) => row.proposal)),
    Effect.orDie,
  );

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The proposal `id`, locked for the transaction under `lock`. */
const findProposal = (id: string, lock: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    if (!uuid.test(id)) {
      return yield* refuse(
        `${id} is not a proposal's id: proposals list shows them.`,
      );
    }
    const rows = yield* sql.unsafe(
      `SELECT ${proposalJson} AS proposal FROM planning.proposals p
       WHERE p.id = $1::uuid${lock ? " FOR UPDATE" : ""}`,
      [id.toLowerCase()],
    );
    const [found] = yield* decodeRows(rows);
    if (found === undefined) {
      return yield* refuse(`No proposal has the id ${id.toLowerCase()}.`);
    }
    return found;
  });

/** The proposal `id`. */
export const getProposal = (id: string) => findProposal(id, false);

/**
 * The proposals with `status` (every one for `all`), oldest first: the
 * order the organizers read them in.
 */
export const listProposals = (status: ProposalStatus | "all" = "new") =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const rows = yield* sql.unsafe(
      `SELECT ${proposalJson} AS proposal FROM planning.proposals p
       ${status === "all" ? "" : "WHERE p.status = $1"}
       ORDER BY p.created_at, p.id`,
      status === "all" ? [] : [status],
    );
    return yield* decodeRows(rows);
  });

/**
 * Records a proposal an organizer was sent (an email, a message), read
 * in as anyone's is, as ALLTHINGS_ACTOR: the stored row.
 */
export const recordProposal = (raw: unknown) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const actor = yield* currentActor;
    const read = readProposal(raw);
    if (!read.ok) {
      return yield* refuse(
        read.problems.map((problem) => problem.message).join(" "),
      );
    }
    const { proposal } = read;
    const rows = yield* sql.unsafe(
      `WITH p AS (
         INSERT INTO planning.proposals
           (title, abstract, format, name, email, about, links, notes, source, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8, 'organizer', $9)
         RETURNING *
       )
       SELECT ${proposalJson} AS proposal FROM p`,
      [
        proposal.title,
        proposal.abstract,
        proposal.format,
        proposal.name,
        proposal.email,
        proposal.about,
        proposal.links as Array<string>,
        proposal.notes,
        actor,
      ],
    );
    const [stored] = yield* decodeRows(rows);
    return stored!;
  });

/** What an organizer decides about a proposal. */
export type DecisionKind = "accept" | "decline" | "remove";

export interface Decision {
  readonly kind: DecisionKind;
  /** Why, kept with the decision (not with a removal, which keeps nothing). */
  readonly note?: string;
}

/** A decision about a proposal as it stands, and its approval token. */
export interface PlannedDecision {
  readonly proposal: Proposal;
  readonly decision: {
    readonly kind: DecisionKind;
    readonly note: string | null;
  };
  readonly token: string;
}

/** `decision` about `proposal`, checked: the decision to hash, or a refusal. */
const checkedDecision = (proposal: Proposal, decision: Decision) =>
  Effect.gen(function* () {
    const note = decision.note?.replaceAll(/\r\n?/g, "\n").trim();
    if (note !== undefined && decision.kind === "remove") {
      return yield* refuse(
        "A removal keeps nothing, so it takes no note: give it to an accept or a decline.",
      );
    }
    if (note === "") return yield* refuse("The note is blank.");
    if (note !== undefined && note.length > proposalLimits.decisionNote) {
      return yield* refuse(
        `The note is ${note.length} characters; keep it to ${proposalLimits.decisionNote}.`,
      );
    }
    const to: Readonly<Record<DecisionKind, ProposalStatus | null>> = {
      accept: "accepted",
      decline: "declined",
      remove: null,
    };
    if (to[decision.kind] === proposal.status) {
      return yield* refuse(
        `${proposal.id} is already ${proposal.status}: nothing to change.`,
      );
    }
    return { kind: decision.kind, note: note ?? null };
  });

/**
 * What deciding `decision` about the proposal `id` would do, and the
 * approval token for exactly that. It only reads.
 */
export const planDecision = (id: string, decision: Decision) =>
  Effect.gen(function* () {
    const proposal = yield* findProposal(id, false);
    const checked = yield* checkedDecision(proposal, decision);
    const planned: PlannedDecision = {
      proposal,
      decision: checked,
      token: yield* approvalToken({ proposal, decision: checked }),
    };
    return planned;
  });

/**
 * Decides `decision` about the proposal `id`, exactly as the dry run that
 * printed `token` showed it, as ALLTHINGS_ACTOR: in one transaction, with
 * the proposal locked, the decision is worked out again and refused unless
 * it hashes to `token`. Accepting or declining returns the proposal as it
 * now is; removing deletes it and returns it as it was.
 */
export const decide = (id: string, decision: Decision, token: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const actor = yield* currentActor;
    if (!isApprovalToken(token)) {
      return yield* refuse(
        `${token} is not an approval token: give the one --dry-run printed.`,
      );
    }
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const proposal = yield* findProposal(id, true);
        const checked = yield* checkedDecision(proposal, decision);
        const now = yield* approvalToken({ proposal, decision: checked });
        if (now !== token) {
          return yield* refuse(
            `The proposal or the decision has changed since ${token} was approved: it is now ${now}. Read it again with --dry-run, and approve that.`,
          );
        }
        if (checked.kind === "remove") {
          yield* sql`DELETE FROM planning.proposals WHERE id = ${proposal.id}::uuid`;
          return proposal;
        }
        const rows = yield* sql.unsafe(
          `WITH p AS (
             UPDATE planning.proposals
             SET status = $2, decided_at = now(), decided_by = $3,
               decision_note = $4, updated_at = now()
             WHERE id = $1::uuid
             RETURNING *
           )
           SELECT ${proposalJson} AS proposal FROM p`,
          [
            proposal.id,
            checked.kind === "accept" ? "accepted" : "declined",
            actor,
            checked.note,
          ],
        );
        const [decided] = yield* decodeRows(rows);
        return decided!;
      }),
    );
  });

/** A proposal in lines, as an organizer reads it. */
export const proposalLines = (proposal: Proposal): ReadonlyArray<string> => [
  `${proposal.id} (${proposal.status}${proposal.decidedBy === null ? "" : ` by ${proposal.decidedBy} on ${proposal.decidedAt!.slice(0, 10)}`})`,
  `title: ${JSON.stringify(proposal.title)}`,
  `format: ${formatLabels[proposal.format]}`,
  `from: ${proposal.name} <${proposal.email}>, ${proposal.createdAt.slice(0, 10)}, via ${proposal.source}${proposal.recordedBy === null ? "" : ` (recorded by ${proposal.recordedBy})`}`,
  ...proposal.links.map((link) => `link: ${link}`),
  "abstract:",
  ...proposal.abstract.split("\n").map((part) => `  ${part}`),
  ...(proposal.about === null
    ? []
    : ["about:", ...proposal.about.split("\n").map((part) => `  ${part}`)]),
  ...(proposal.notes === null
    ? []
    : ["notes:", ...proposal.notes.split("\n").map((part) => `  ${part}`)]),
  ...(proposal.decisionNote === null
    ? []
    : [`decision note: ${JSON.stringify(proposal.decisionNote)}`]),
];

/** A proposal in one line, for a list. */
export const proposalLine = (proposal: Proposal): string =>
  `${proposal.id} ${proposal.createdAt.slice(0, 10)} ${proposal.status} ${proposal.format} ${JSON.stringify(proposal.title)}, ${proposal.name} <${proposal.email}> via ${proposal.source}`;
