import type { SitePointer } from "./page-store.ts";

/**
 * Where the writers tell the site its data changed: the Sync Worker after
 * each run that writes (through its service binding), and anything else
 * that writes and holds the token. A POST with `Authorization: Bearer
 * <SITE_REFRESH_TOKEN>` has the Worker ask the database for the data's
 * version at once (page-store.ts's
 * `refreshSite`), so a change is shown once Hyperdrive's cache has turned
 * over, not at the next check. It reads one row-digest and writes one KV
 * value; it never writes the database, and it answers with the version
 * only, which any page's data already shows.
 *
 * Without a token the Worker has no such path (404), so stages that aren't
 * told of writes don't answer it.
 */
export const refreshPath = "/_site/refresh";

const answer = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

/** Whether two strings are equal, in time that depends on neither's content. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const digest = async (text: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    );
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

/** The answer to a request at {@link refreshPath}. */
export async function refreshRequest(
  request: Request,
  token: string | undefined,
  refresh: () => Promise<SitePointer>,
): Promise<Response> {
  if (token === undefined || token === "") {
    return new Response("Not found", { status: 404 });
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "POST", "cache-control": "no-store" },
    });
  }
  const given = /^Bearer (.+)$/.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  if (given === undefined || !(await sameSecret(given, token))) {
    return answer(401, { error: "unauthorized" });
  }
  try {
    const pointer = await refresh();
    return answer(200, {
      checkedAt: new Date(pointer.checkedAt).toISOString(),
      version: pointer.current?.version ?? null,
      next:
        pointer.next === undefined
          ? null
          : {
              version: pointer.next.version,
              from: new Date(pointer.next.from).toISOString(),
            },
    });
  } catch {
    return answer(503, { error: "the data's version couldn't be read" });
  }
}
