import { Effect } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { CacheControl } from "../cache.ts";
import {
  clientOf,
  type Outcome,
  outcomeMessages,
  proposalBodyLimit,
  proposalsPath,
  takeProposal,
} from "../proposals.ts";

/**
 * `POST /api/v1/proposals`: a talk proposal as JSON, for anyone's own
 * client (curl, a script, an agent without MCP). The body is the proposal's
 * fields (core's readProposal): `title`, `abstract`, `name` and `email`,
 * and optionally `format`, `about`, `links` and `notes`.
 *
 * Only `application/json`, which a browser can't send to another origin
 * without a preflight this never answers, so no other site's page can
 * post one; and a request a browser says came from another site is
 * refused outright. At most {@link proposalBodyLimit} bytes. The answer
 * says only whether it was taken, never anything stored.
 */

/** Each outcome's status. */
const statusOf: Readonly<Record<Outcome["_tag"], number>> = {
  Kept: 202,
  Invalid: 422,
  Limited: 429,
  Full: 429,
  Closed: 503,
  Unavailable: 503,
};

const answer = (
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) =>
  HttpServerResponse.json(body, {
    status,
    headers: { "cache-control": CacheControl.failure, ...headers },
  });

/** The answer to an outcome: what was taken, or each problem, or why not. */
const outcomeAnswer = (outcome: Outcome) =>
  outcome._tag === "Kept"
    ? answer(202, { received: true, message: outcomeMessages.Kept })
    : answer(
        statusOf[outcome._tag],
        {
          error: outcomeMessages[outcome._tag],
          ...(outcome._tag === "Invalid" ? { problems: outcome.problems } : {}),
        },
        outcome._tag === "Limited"
          ? { "retry-after": "60" }
          : outcome._tag === "Full"
            ? { "retry-after": "3600" }
            : {},
      );

type Body =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly status: number; readonly error: string };

/**
 * A refusal, once the request's body is read off and dropped (up to
 * proposalBodyLimit, then let go), so the connection it came on stays
 * usable.
 */
async function refused(
  request: Request,
  status: number,
  error: string,
): Promise<Body> {
  await bounded(request, proposalBodyLimit);
  return { ok: false, status, error };
}

/**
 * The body's bytes, read only up to `limit`: undefined past it, however
 * long the body says it is, so nothing larger is ever held.
 */
async function bounded(
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

/** Why a request's body can't be read as a proposal, or the body. */
async function readJson(request: Request): Promise<Body> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;.*)?$/i.test(type)) {
    return refused(request, 415, "Send the proposal as application/json.");
  }
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > proposalBodyLimit) {
    return refused(request, 413, "That's too long to send.");
  }
  const bytes = await bounded(request, proposalBodyLimit);
  if (bytes === undefined) {
    return { ok: false, status: 413, error: "That's too long to send." };
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, status: 400, error: "The body isn't JSON." };
  }
}

export const proposalsRoute = HttpRouter.add(
  "POST",
  proposalsPath,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.toWeb(
      yield* HttpServerRequest.HttpServerRequest,
    );
    // A browser names the page that sent it; only this site's may.
    const origin = request.headers.get("origin");
    const body = yield* Effect.promise(() =>
      origin !== null && origin !== new URL(request.url).origin
        ? refused(
            request,
            403,
            "Proposals aren't taken from another site's page.",
          )
        : readJson(request),
    );
    if (!body.ok) return yield* answer(body.status, { error: body.error });
    return yield* outcomeAnswer(
      yield* takeProposal(body.value, "api", clientOf(request)),
    );
  }),
);
