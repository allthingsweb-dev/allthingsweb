import type { PGlite } from "@electric-sql/pglite";
import type { Answer } from "./http.ts";

/**
 * The retired app's public surfaces, as it answered them: its v1 route
 * handlers and its MCP tools, wired as app/src/app/mcp/route.ts wired them,
 * over core's seed. Each answer the tests compare with was recorded in
 * fixtures/legacy-app.json on 2026-11-10, ahead of the app's deletion, so the Worker is
 * still held to them.
 *
 * The seed stamps the rows it doesn't date with the time it ran, so the
 * recorded answers hold that time as `{seededAt}`, and each lookup puts back
 * the seed time of the database the Worker reads.
 */

interface Recorded {
  readonly v1: Readonly<Record<string, Answer>>;
  readonly mcp: ReadonlyArray<{
    readonly request: {
      readonly method: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: string | null;
    };
    readonly answer: Answer;
  }>;
}

export interface App {
  /** The app's answer to a GET of one of the v1 API's paths. */
  readonly v1: (path: string) => Answer;
  /** The app's MCP endpoint's answer to a request. */
  readonly mcp: (
    method: string,
    headers: Readonly<Record<string, string>>,
    body: string | null,
  ) => Answer;
}

/** One request's key among the recorded MCP answers: its method, headers and body. */
const keyOf = (
  method: string,
  headers: Readonly<Record<string, string>>,
  body: string | null,
): string => JSON.stringify([method, headers, body]);

/**
 * The app's recorded answers, with `{seededAt}` set to when `db`'s seed ran.
 * A request the recording doesn't have fails the test, naming it.
 */
export async function loadApp(db: PGlite): Promise<App> {
  const recorded = (await Bun.file(
    new URL("../fixtures/legacy-app.json", import.meta.url),
  ).json()) as Recorded;
  // Every row the seed doesn't date has the same created_at: when it ran.
  const { rows } = await db.query<{ at: Date }>(
    "SELECT created_at AS at FROM events WHERE id = 'e0000000-0000-4000-8000-000000000001'",
  );
  const seededAt = rows[0]?.at.toISOString();
  if (seededAt === undefined) throw new Error("The seed has no event 1.");
  /** `answer` with the seed time of `db` in place of `{seededAt}`. */
  const restore = (answer: Answer): Answer => ({
    ...answer,
    body: answer.body.replaceAll("{seededAt}", seededAt),
  });
  const mcp = new Map(
    recorded.mcp.map(({ request, answer }) => [
      keyOf(request.method, request.headers, request.body),
      answer,
    ]),
  );
  return {
    v1: (path) => {
      const answer = recorded.v1[path];
      if (answer === undefined) {
        throw new Error(`The app's answer to GET ${path} wasn't recorded.`);
      }
      return restore(answer);
    },
    mcp: (method, headers, body) => {
      const answer = mcp.get(keyOf(method, headers, body));
      if (answer === undefined) {
        throw new Error(
          `The app's answer to ${method} /mcp ${body ?? ""} wasn't recorded.`,
        );
      }
      return restore(answer);
    },
  };
}
