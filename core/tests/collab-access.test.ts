import { describe, expect, test } from "bun:test";
import { Cause, ConfigProvider, Effect, Exit, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import {
  ACCOUNT_ID,
  AccessError,
  AccessList,
  apiBase,
  COLLABORATOR_LIST,
  difference,
} from "../src/collab/access.ts";
import { COLLABORATOR_LIST as listMadeByTheScript } from "../../infra/scripts/zero-trust-store.ts";

/**
 * The edge's list of collaborators (src/collab/access.ts) against a fake
 * Cloudflare: the requests it sends, what it changes, and how it refuses.
 * Nothing here reaches Cloudflare.
 */

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

const token = "test-only-token";
const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;

/** A fake Cloudflare holding `lists`, and the requests it was sent. */
function fakeCloudflare(
  lists: Array<{
    id: string;
    name: string;
    type: string;
    items: Array<string>;
  }>,
  options: {
    readonly fail?: string;
    /** Entries a page, as Cloudflare pages lists and their items. */
    readonly perPage?: number;
    /** Items answered nested one deep, as Cloudflare has answered them. */
    readonly nested?: boolean;
  } = {},
) {
  const perPage = options.perPage ?? 100;
  const paged = <A>(all: ReadonlyArray<A>, page: number) =>
    all.slice((page - 1) * perPage, page * perPage);
  const sent: Array<Sent> = [];
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const client = HttpClient.make((request, url) =>
    Effect.sync(() => {
      const body =
        request.body._tag === "Uint8Array"
          ? (JSON.parse(new TextDecoder().decode(request.body.body)) as unknown)
          : undefined;
      sent.push({
        method: request.method,
        url: url.href,
        authorization: request.headers["authorization"],
        body,
      });
      const path = url.pathname.slice(new URL(base).pathname.length);
      const page = Number(url.searchParams.get("page") ?? "1");
      if (options.fail !== undefined && path.startsWith(options.fail)) {
        return HttpClientResponse.fromWeb(
          request,
          reply(
            { success: false, errors: [{ message: "Authentication error" }] },
            403,
          ),
        );
      }
      if (request.method === "GET" && path === "/gateway/lists") {
        return HttpClientResponse.fromWeb(
          request,
          reply({
            success: true,
            result: paged(
              lists.map(({ id, name, type }) => ({ id, name, type })),
              page,
            ),
            result_info: { page },
          }),
        );
      }
      const items = /^\/gateway\/lists\/([^/]+)\/items$/.exec(path);
      const listed = lists.find((l) => l.id === items?.[1]);
      if (items !== null && listed !== undefined && request.method === "GET") {
        const values = paged(listed.items, page).map((value) => ({ value }));
        return HttpClientResponse.fromWeb(
          request,
          reply({
            success: true,
            result:
              options.nested === true && values.length > 0 ? [values] : values,
            result_info: { page },
          }),
        );
      }
      const one = /^\/gateway\/lists\/([^/]+)$/.exec(path);
      const list = lists.find((l) => l.id === one?.[1]);
      if (one !== null && list !== undefined && request.method === "PUT") {
        list.items = (body as { items: Array<{ value: string }> }).items.map(
          (item) => item.value,
        );
        return HttpClientResponse.fromWeb(
          request,
          reply({ success: true, result: list }),
        );
      }
      if (
        request.method === "POST" &&
        path === "/access/organizations/revoke_user"
      ) {
        return HttpClientResponse.fromWeb(
          request,
          reply({ success: true, result: true }),
        );
      }
      return HttpClientResponse.fromWeb(
        request,
        reply({ success: false, errors: [{ message: "not found" }] }, 404),
      );
    }),
  );
  return { sent, layer: Layer.succeed(HttpClient.HttpClient, client) };
}

const run = <A>(
  fake: ReturnType<typeof fakeCloudflare>,
  f: (access: AccessList["Service"]) => Effect.Effect<A, AccessError>,
  env: Record<string, string> = { CLOUDFLARE_ZERO_TRUST_TOKEN: token },
) =>
  Effect.runPromiseExit(
    AccessList.use(f).pipe(
      Effect.provide(
        AccessList.cloudflare.pipe(
          Layer.provide(fake.layer),
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
        ),
      ),
    ),
  );

const value = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
  return exit.value;
};

const reason = (exit: Exit.Exit<unknown, unknown>): string => {
  if (Exit.isSuccess(exit)) throw new Error("expected a refusal");
  const error = Cause.squash(exit.cause);
  return error instanceof Error ? error.message : String(error);
};

const collaborators = () => ({
  id: "list-1",
  name: COLLABORATOR_LIST,
  type: "EMAIL",
  items: ["gone@example.com", "kept@example.com"],
});

describe("the collaborators list", () => {
  test("is set to exactly the active emails, with the token, once", async () => {
    const list = collaborators();
    const fake = fakeCloudflare([
      { id: "other", name: "something else", type: "EMAIL", items: [] },
      list,
    ]);
    const synced = value(
      await run(fake, (access) =>
        access.sync(["kept@example.com", "New@Example.com"]),
      ),
    );
    expect(synced).toEqual({
      listId: "list-1",
      added: ["new@example.com"],
      removed: ["gone@example.com"],
    });
    expect(list.items).toEqual(["kept@example.com", "new@example.com"]);
    expect(
      fake.sent.map(
        (s) =>
          `${s.method} ${new URL(s.url).pathname.slice(new URL(base).pathname.length)}`,
      ),
    ).toEqual([
      // Each listing read to its first empty page, the items from their own endpoint.
      "GET /gateway/lists",
      "GET /gateway/lists",
      "GET /gateway/lists/list-1/items",
      "GET /gateway/lists/list-1/items",
      "PUT /gateway/lists/list-1",
    ]);
    expect(fake.sent.every((s) => s.authorization === `Bearer ${token}`)).toBe(
      true,
    );
  });

  test("already right, is left alone", async () => {
    const fake = fakeCloudflare([collaborators()]);
    value(
      await run(fake, (access) =>
        access.sync(["kept@example.com", "gone@example.com"]),
      ),
    );
    expect(fake.sent.some((s) => s.method === "PUT")).toBe(false);
  });

  test("planned, changes nothing", async () => {
    const list = collaborators();
    const fake = fakeCloudflare([list]);
    expect(value(await run(fake, (access) => access.plan([])))).toEqual({
      listId: "list-1",
      added: [],
      removed: ["gone@example.com", "kept@example.com"],
    });
    expect(list.items).toHaveLength(2);
  });

  test("missing, doubled or of another type, is refused", async () => {
    expect(
      reason(await run(fakeCloudflare([]), (access) => access.sync([]))),
    ).toBe(
      `The Zero Trust list "${COLLABORATOR_LIST}" doesn't exist: infra/scripts/zero-trust-token.sh makes it.`,
    );
    expect(
      reason(
        await run(
          fakeCloudflare([
            collaborators(),
            { ...collaborators(), id: "list-2" },
          ]),
          (access) => access.sync([]),
        ),
      ),
    ).toBe(
      `"${COLLABORATOR_LIST}" must be one email list; found list-1 (EMAIL), list-2 (EMAIL).`,
    );
  });

  test("Cloudflare's refusal is said, and nothing more is sent", async () => {
    const fake = fakeCloudflare([collaborators()], {
      fail: "/gateway/lists/list-1",
    });
    expect(
      reason(await run(fake, (access) => access.sync(["a@example.com"]))),
    ).toBe(
      "reading the collaborators list: Cloudflare answered 403: Authentication error",
    );
    expect(fake.sent.some((s) => s.method === "PUT")).toBe(false);
  });
});

describe("pages", () => {
  test("every page of lists and of items is read, flat or nested", async () => {
    for (const nested of [false, true]) {
      const list = {
        id: "list-9",
        name: COLLABORATOR_LIST,
        type: "EMAIL",
        items: ["a@example.com", "b@example.com", "c@example.com"],
      };
      const fake = fakeCloudflare(
        [
          { id: "x", name: "one", type: "EMAIL", items: [] },
          { id: "y", name: "two", type: "IP", items: [] },
          list,
        ],
        { perPage: 2, nested },
      );
      expect(
        value(
          await run(fake, (access) =>
            access.plan(["a@example.com", "b@example.com", "c@example.com"]),
          ),
        ),
      ).toEqual({ listId: "list-9", added: [], removed: [] });
      expect(
        fake.sent.map((s) => new URL(s.url).searchParams.get("page")),
      ).toEqual(["1", "2", "3", "1", "2", "3"]);
    }
  });

  test("a revoked member on a later page of items is still removed", async () => {
    const list = {
      id: "list-9",
      name: COLLABORATOR_LIST,
      type: "EMAIL",
      items: ["kept@example.com", "gone@example.com"],
    };
    const fake = fakeCloudflare([list], { perPage: 1 });
    expect(
      value(await run(fake, (access) => access.sync(["kept@example.com"]))),
    ).toEqual({ listId: "list-9", added: [], removed: ["gone@example.com"] });
    expect(list.items).toEqual(["kept@example.com"]);
  });
});

describe("sessions", () => {
  test("are ended by email", async () => {
    const fake = fakeCloudflare([]);
    value(
      await run(fake, (access) => access.revokeSessions("gone@example.com")),
    );
    expect(fake.sent).toEqual([
      {
        method: "POST",
        url: `${base}/access/organizations/revoke_user`,
        authorization: `Bearer ${token}`,
        body: { email: "gone@example.com" },
      },
    ]);
  });
});

describe("the token", () => {
  test("missing, is refused before anything is sent", async () => {
    const fake = fakeCloudflare([collaborators()]);
    expect(reason(await run(fake, (access) => access.ready, {}))).toStartWith(
      "CLOUDFLARE_ZERO_TRUST_TOKEN is not set",
    );
    expect(
      reason(await run(fake, (access) => access.sync([]), {})),
    ).toStartWith("CLOUDFLARE_ZERO_TRUST_TOKEN is not set");
    expect(fake.sent).toEqual([]);
  });

  test("goes to Cloudflare, or to this machine for tests, and nowhere else", () => {
    expect(apiBase(undefined)).toBe("https://api.cloudflare.com/client/v4");
    expect(apiBase("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    for (const elsewhere of [
      "https://evil.example.com",
      "http://127.0.0.1.evil.example.com:80",
      "http://localhost:8787",
      "http://127.0.0.1:8787/path",
    ]) {
      expect(apiBase(elsewhere)).toBeInstanceOf(AccessError);
    }
  });
});

test("difference is by email, in any case, sorted", () => {
  expect(difference(["B@x.io", "a@x.io"], ["b@x.io", "c@x.io"])).toEqual({
    added: ["c@x.io"],
    removed: ["a@x.io"],
  });
});

test("the list is the one infra/scripts/zero-trust-token.sh makes", () => {
  expect(COLLABORATOR_LIST).toBe(listMadeByTheScript);
});
