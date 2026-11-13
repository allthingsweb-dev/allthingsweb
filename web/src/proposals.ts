import { PgClient } from "@effect/sql-pg";
import {
  type IntakeSource,
  submitProposal,
} from "allthings-core/src/proposal-intake.ts";
import {
  type ProposalProblem,
  readProposal,
} from "allthings-core/src/proposals.ts";
import { Context, Effect, Layer, Option, Redacted } from "effect";
import type { HyperdriveBinding } from "./database.ts";

/**
 * Talk proposals from anyone (core's README, "Taking proposals from
 * anyone"): the site's form, its MCP server, the CLI and the API all hand
 * what they were sent to {@link takeProposal}, which counts the sender
 * against the edge's rate limit, reads the proposal in (core's
 * readProposal, a reason per field), and keeps it as `proposal_intake`
 * through the `INTAKE` Hyperdrive, a role that may only add one. Nothing
 * stored is ever read back or shown: the answer says only whether it was
 * taken.
 *
 * Only prod has `INTAKE` (infra/src/web.ts): every other stage reads
 * production and must not write to it, so there a proposal is read in,
 * and then refused as {@link Outcome} `Closed`.
 */

/** Where the API takes a proposal, as JSON. */
export const proposalsPath = "/api/v1/proposals";

/** The most a proposal's body may be, in bytes: far past the longest one the limits allow. */
export const proposalBodyLimit = 16_384;

// workerd's binding exposes its fields as getters on its prototype, so the
// field is read, not looked up as an own property.
const isHyperdriveBinding = (value: unknown): value is HyperdriveBinding =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { connectionString?: unknown }).connectionString ===
    "string";

/** The Worker's `INTAKE` binding, if it has one: Hyperdrive, as proposal_intake. */
export class Intake extends Context.Reference<Option.Option<HyperdriveBinding>>(
  "allthings/web/Intake",
  { defaultValue: () => Option.none() },
) {
  static readonly layer = (env: Readonly<Record<string, unknown>>) =>
    Layer.succeed(
      Intake,
      Option.liftPredicate(env["INTAKE"], isHyperdriveBinding),
    );
}

/** What the Worker uses of a Rate Limiting binding. */
export interface RateLimiter {
  readonly limit: (options: {
    readonly key: string;
  }) => Promise<{ readonly success: boolean }>;
}

const isRateLimiter = (value: unknown): value is RateLimiter =>
  typeof value === "object" &&
  value !== null &&
  typeof Reflect.get(value, "limit") === "function";

/**
 * The Worker's `PROPOSALS_LIMIT` binding, if it has one: how many
 * proposals one address may send a minute (infra/src/web.ts).
 */
export class ProposalLimit extends Context.Reference<
  Option.Option<RateLimiter>
>("allthings/web/ProposalLimit", { defaultValue: () => Option.none() }) {
  static readonly layer = (env: Readonly<Record<string, unknown>>) =>
    Layer.succeed(
      ProposalLimit,
      Option.liftPredicate(env["PROPOSALS_LIMIT"], isRateLimiter),
    );
}

/** How a proposal was taken, or why not. */
export type Outcome =
  | { readonly _tag: "Kept" }
  | {
      readonly _tag: "Invalid";
      readonly problems: ReadonlyArray<ProposalProblem>;
    }
  /** Too many from this address in the last minute. */
  | { readonly _tag: "Limited" }
  /** The table took its day's proposals from outside. */
  | { readonly _tag: "Full" }
  /** This stage doesn't take proposals: only prod does. */
  | { readonly _tag: "Closed" }
  /** The database, or the limiter, didn't answer. */
  | { readonly _tag: "Unavailable" };

/** What each outcome says to whoever sent the proposal. */
export const outcomeMessages: Readonly<
  Record<Exclude<Outcome["_tag"], "Invalid">, string>
> & { readonly Invalid: string } = {
  Kept: "Thanks: your proposal is in. Erik and Andre read every one, and reply by email.",
  Invalid: "Some of the proposal needs another look: see each field's problem.",
  Limited:
    "That's a lot of proposals from one place in a minute. Wait a minute, then send it again.",
  Full: "We've had more proposals than usual today, so this one wasn't kept. Please send it again tomorrow, or email hello@allthings.dev.",
  Closed:
    "This copy of the site doesn't take proposals. Send yours at https://allthings.dev/propose.",
  Unavailable:
    "Proposals can't be taken right now. Please try again in a minute, or email hello@allthings.dev.",
};

/** A pool on the intake Hyperdrive, TLS off on the Worker's leg (as database.ts's). */
const intakePool = (binding: HyperdriveBinding) =>
  PgClient.layer({
    url: Redacted.make(binding.connectionString),
    ssl: false,
  });

/**
 * Takes a proposal as sent (untrusted: anything) through `source`, from
 * the address `client` (Cloudflare's `CF-Connecting-IP`): counted against
 * the rate limit first, so even a refused one counts; then read in; then
 * kept. Never fails: every way it can go is an {@link Outcome}.
 */
export const takeProposal = (
  raw: unknown,
  source: IntakeSource,
  client: string,
): Effect.Effect<Outcome> =>
  Effect.gen(function* () {
    const limiter = yield* ProposalLimit;
    if (Option.isSome(limiter)) {
      const allowed = yield* Effect.tryPromise(() =>
        limiter.value.limit({ key: `proposals:${client}` }),
      ).pipe(
        Effect.map(({ success }) => success),
        Effect.catch((cause) =>
          Effect.logError("The proposals rate limit failed", cause).pipe(
            Effect.as(undefined),
          ),
        ),
      );
      if (allowed === undefined) return { _tag: "Unavailable" } as const;
      if (!allowed) return { _tag: "Limited" } as const;
    }
    const read = readProposal(raw);
    if (!read.ok) {
      return { _tag: "Invalid", problems: read.problems } as const;
    }
    const intake = yield* Intake;
    if (Option.isNone(intake)) return { _tag: "Closed" } as const;
    return yield* submitProposal(read.proposal, source).pipe(
      Effect.provide(intakePool(intake.value)),
      Effect.as({ _tag: "Kept" } as const),
      Effect.catchTag("ProposalIntakeFull", () =>
        Effect.succeed({ _tag: "Full" } as const),
      ),
      Effect.catchCause((cause) =>
        Effect.logError("A proposal couldn't be kept", cause).pipe(
          Effect.as({ _tag: "Unavailable" } as const),
        ),
      ),
    );
  });

/** The address a request came from, as Cloudflare names it; "unknown" without one (tests). */
export const clientOf = (request: Request): string =>
  request.headers.get("cf-connecting-ip") ?? "unknown";

/**
 * A request's body, read only up to `limit` bytes: undefined past it,
 * however long the body says it is, so nothing larger is ever held. Read
 * off even when it is refused, so the connection it came on stays usable.
 */
export async function boundedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array | undefined> {
  const reader = request.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Array<Uint8Array> = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}
