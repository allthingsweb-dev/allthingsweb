import { describe, expect, test } from "bun:test";
import {
  COLLABORATOR_LIST_ID,
  previewPolicies,
  PREVIEW_VIEWERS,
} from "../src/preview.ts";
import { COLLABORATOR_LIST, ensureList } from "../scripts/zero-trust-store.ts";

/**
 * Draft collaboration's edge (core/README.md, "Collaborating on a draft"):
 * the preview's Access policies, the studio's token spec, and the list
 * zero-trust-token.sh makes, against a fake Cloudflare.
 */

describe("the preview's Access policies", () => {
  test("admit the organizers alone until the list exists", () => {
    expect(COLLABORATOR_LIST_ID).toBeUndefined();
    expect(previewPolicies()).toEqual([
      {
        name: "The organizers",
        decision: "allow",
        include: PREVIEW_VIEWERS.map((email) => ({ email })),
      },
    ]);
  });

  test("then admit the list's emails too", () => {
    expect(previewPolicies("list-1")).toEqual([
      {
        name: "The organizers",
        decision: "allow",
        include: PREVIEW_VIEWERS.map((email) => ({ email })),
      },
      {
        name: "Invited collaborators",
        decision: "allow",
        include: [{ emailList: { id: "list-1" } }],
      },
    ]);
  });
});

test("the studio's token holds Zero Trust list writes and session revocation, nothing else", async () => {
  const spec = (await Bun.file(
    new URL("../zero-trust-token.json", import.meta.url),
  ).json()) as {
    account: string;
    permissionGroups: Array<string>;
    item: string;
  };
  expect(spec.account).toBe("af627f300cd00c4dca56aacf05bea050");
  expect(spec.permissionGroups).toEqual([
    "Zero Trust Write",
    "Access: Organizations Revoke",
  ]);
  expect(spec.item).toBe("allthings zero trust");
});

describe("ensureList", () => {
  /** A fake Cloudflare holding `lists`, `perPage` to a page as it pages them. */
  const fake = (
    lists: Array<{ id: string; name: string; type: string }>,
    refusals = 0,
    perPage = 100,
  ) => {
    const sent: Array<{
      method: string;
      body: unknown;
      authorization: string | null;
    }> = [];
    let refused = 0;
    const fetcher = async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      sent.push({
        method: init?.method ?? "GET",
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : undefined,
        authorization: headers.get("authorization"),
      });
      if (refused < refusals) {
        refused++;
        return Response.json(
          { success: false, errors: [{ message: "Authentication error" }] },
          { status: 403 },
        );
      }
      if ((init?.method ?? "GET") === "GET") {
        const page = Number(new URL(url).searchParams.get("page") ?? "1");
        return Response.json({
          success: true,
          result: lists.slice((page - 1) * perPage, page * perPage),
          result_info: { page },
        });
      }
      return Response.json({ success: true, result: { id: "made-1" } });
    };
    return { sent, fetcher };
  };

  test("finds the list by name", async () => {
    const cf = fake([
      { id: "other", name: "something", type: "EMAIL" },
      { id: "list-1", name: COLLABORATOR_LIST, type: "EMAIL" },
    ]);
    expect(await ensureList("acct", "t", cf.fetcher)).toEqual({
      id: "list-1",
      created: false,
    });
    // Page 1, then an empty page 2: every page read.
    expect(cf.sent.map((s) => s.method)).toEqual(["GET", "GET"]);
    expect(cf.sent[0]?.authorization).toBe("Bearer t");
  });

  test("finds it on a later page, and never makes a second", async () => {
    const cf = fake(
      [
        { id: "a", name: "first", type: "EMAIL" },
        { id: "b", name: "second", type: "IP" },
        { id: "list-1", name: COLLABORATOR_LIST, type: "EMAIL" },
      ],
      0,
      2,
    );
    expect(await ensureList("acct", "t", cf.fetcher)).toEqual({
      id: "list-1",
      created: false,
    });
    expect(cf.sent.map((s) => s.method)).toEqual(["GET", "GET", "GET"]);
  });

  test("makes it empty, as an email list, when it isn't there", async () => {
    const cf = fake([]);
    expect(await ensureList("acct", "t", cf.fetcher)).toEqual({
      id: "made-1",
      created: true,
    });
    expect(cf.sent[1]).toMatchObject({
      method: "POST",
      body: { name: COLLABORATOR_LIST, type: "EMAIL", items: [] },
    });
  });

  test("waits out a new token's first refusals, then gives up", async () => {
    const cf = fake(
      [{ id: "list-1", name: COLLABORATOR_LIST, type: "EMAIL" }],
      2,
    );
    expect(await ensureList("acct", "t", cf.fetcher, { wait: 0 })).toEqual({
      id: "list-1",
      created: false,
    });
    const never = fake([], 10);
    await expect(
      ensureList("acct", "t", never.fetcher, { tries: 3, wait: 0 }),
    ).rejects.toThrow("Cloudflare answered 403: Authentication error");
  });

  test("refuses two lists of the name, or one of another type", async () => {
    await expect(
      ensureList(
        "acct",
        "t",
        fake([{ id: "a", name: COLLABORATOR_LIST, type: "DOMAIN" }]).fetcher,
      ),
    ).rejects.toThrow(
      `"${COLLABORATOR_LIST}" must be one email list; found a (DOMAIN).`,
    );
  });
});
