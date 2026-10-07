import { afterAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect, Exit, Layer, Option, Redacted } from "effect";
import { approvalToken } from "../src/approval.ts";
import { Promo } from "../src/promo/promo.ts";
import {
  adoptSignIn,
  ourXAccount,
  XAnnounce,
} from "../src/social/announce-x.ts";
import { sameText, X } from "../src/social/x.ts";
import {
  fromXurl,
  SignInUnavailable,
  XSignIn,
} from "../src/social/x-sign-in.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";
import { configFrom, fakeLumaBy, type Reply, settle } from "./support/luma.ts";

/**
 * Posting to X (src/social/) with X's API faked as docs.x.com documents it,
 * every request recorded, and the sign-in held in memory or in a fake `op`:
 * nothing here reaches X or 1Password. The evening is tests/seed.sql's
 * React at Acme.
 */

const db = await seededDatabase();
afterAll(() => db.close());

const slug = "2026-08-12-react-at-acme";
const timeline = `/2/users/${ourXAccount.id}/tweets`;
const env = {
  X_BEARER_TOKEN: "app-bearer",
  X_CLIENT_ID: "client-id",
  X_CLIENT_SECRET: "client-secret",
};

const json = (value: unknown, status = 200): Reply => ({
  status,
  body: JSON.stringify(value),
});
const posts = (texts: ReadonlyArray<string>) =>
  json({ data: texts.map((text, i) => ({ id: `19${i}`, text })) });
const tokens = json({
  token_type: "bearer",
  expires_in: 7200,
  access_token: "access-2",
  refresh_token: "refresh-2",
  scope: "tweet.read tweet.write users.read offline.access",
});
const me = (
  id: string = ourXAccount.id,
  username: string = ourXAccount.handle,
) => json({ data: { id, name: "All Things Web", username } });

const failingStore = (token: string) =>
  Layer.succeed(
    XSignIn,
    XSignIn.of({
      read: Effect.succeed(Option.some(Redacted.make(token))),
      write: () =>
        Effect.fail(
          new SignInUnavailable({ reason: "1Password didn't answer" }),
        ),
    }),
  );

const run = async <A, E>(
  f: (announce: XAnnounce["Service"]) => Effect.Effect<A, E>,
  replies: Record<string, ReadonlyArray<Reply>>,
  options: {
    readonly stored?: string | null;
    readonly store?: Layer.Layer<XSignIn>;
    readonly env?: Record<string, string>;
  } = {},
) => {
  const fake = fakeLumaBy((url) => url.pathname, replies);
  const memory = XSignIn.memory(
    options.stored === undefined ? "refresh-1" : options.stored,
  );
  const layer = XAnnounce.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Promo.layer,
        options.store ?? memory.layer,
        X.layer.pipe(
          Layer.provide(
            Layer.mergeAll(fake.layer, configFrom(options.env ?? env)),
          ),
        ),
      ),
    ),
    Layer.provideMerge(sqlLayer(db)),
    Layer.provideMerge(clockLayer),
  );
  const exit = await Effect.runPromiseExit(
    settle(XAnnounce.use(f)).pipe(Effect.provide(layer)),
  );
  return {
    exit,
    requests: fake.requests,
    stored: memory.stored,
    posted: fake.requests.filter(
      (r) => r.method === "POST" && r.url.endsWith("/2/tweets"),
    ),
  };
};

const value = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
  return exit.value;
};
const reason = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) throw new Error("expected a failure");
  const error = Cause.squash(exit.cause);
  return error instanceof Error ? error.message : String(error);
};

const reads = { [timeline]: [posts(["Something else"])] };

describe("matching our posts", () => {
  test("links count as one, whatever X shortened them to, and entities are read", () => {
    expect(
      sameText(
        "Talks &amp; demos\n\nhttps://t.co/AbC123",
        "Talks & demos\n\nhttps://lu.ma/event/evt-react",
      ),
    ).toBe(true);
    expect(sameText("Talks & demos", "Talks and demos")).toBe(false);
  });
});

describe("the dry run", () => {
  test("makes the post from the draft, with its token, reading only with the app's token", async () => {
    const { exit, requests, stored } = await run(
      (a) => a.prepare(slug, "announce"),
      reads,
    );
    const prepared = value(exit);
    expect(prepared.text).toContain("all things/react");
    expect(prepared.alreadyPosted).toBeNull();
    expect(prepared.token).toBe(
      await Effect.runPromise(
        approvalToken({
          channel: "x",
          account: ourXAccount.id,
          slug,
          moment: "announce",
          text: prepared.text,
        }),
      ),
    );
    expect(requests.map((r) => [r.method, r.url, r.authorization])).toEqual([
      [
        "GET",
        `https://api.x.com${timeline}?max_results=10&exclude=replies%2Cretweets`,
        "Bearer app-bearer",
      ],
    ]);
    // No sign-in was spent.
    expect(stored.value).toBe("refresh-1");
  });

  test("says when the account already posted this text", async () => {
    const draft = value(
      (await run((a) => a.prepare(slug, "announce"), reads)).exit,
    ).text;
    const listed = draft.replace(/https?:\/\/\S+/g, "https://t.co/x1");
    const { exit } = await run((a) => a.prepare(slug, "announce"), {
      [timeline]: [posts(["Older", listed])],
    });
    expect(value(exit).alreadyPosted).toBe(
      "https://x.com/allthingswebdev/status/191",
    );
  });
});

describe("posting", () => {
  const token = async () =>
    value((await run((a) => a.prepare(slug, "announce"), reads)).exit).token;

  test("signs in, keeps the new sign-in first, and posts exactly what was approved, once", async () => {
    const approved = await token();
    const { exit, requests, stored, posted } = await run(
      (a) => a.post(slug, "announce", approved),
      {
        ...reads,
        "/2/oauth2/token": [tokens],
        "/2/users/me": [me()],
        "/2/tweets": [json({ data: { id: "1999", text: "…" } }, 201)],
      },
    );
    const result = value(exit);
    expect(result.url).toBe("https://x.com/allthingswebdev/status/1999");
    expect(stored.value).toBe("refresh-2");
    expect(
      requests.map((r) => `${r.method} ${new URL(r.url).pathname}`),
    ).toEqual([
      `GET ${timeline}`,
      "POST /2/oauth2/token",
      "GET /2/users/me",
      "POST /2/tweets",
    ]);
    const signIn = requests[1];
    expect(signIn?.authorization).toBe(
      `Basic ${btoa("client-id:client-secret")}`,
    );
    expect(Object.fromEntries(new URLSearchParams(signIn?.body ?? ""))).toEqual(
      {
        grant_type: "refresh_token",
        refresh_token: "refresh-1",
      },
    );
    expect(requests[2]?.authorization).toBe("Bearer access-2");
    expect(posted).toHaveLength(1);
    expect(posted[0]?.authorization).toBe("Bearer access-2");
    expect(JSON.parse(posted[0]?.body ?? "")).toEqual({ text: result.text });
  });

  test("refuses a stale token, a text already out, and no sign-in, signing in to nothing", async () => {
    const approved = await token();
    const stale = await run(
      (a) => a.post(slug, "announce", "0000000000000000"),
      reads,
    );
    expect(reason(stale.exit)).toMatch(
      /^What would be posted has changed since 0000000000000000 was approved/,
    );
    const draft = value(
      (await run((a) => a.prepare(slug, "announce"), reads)).exit,
    ).text;
    const already = await run((a) => a.post(slug, "announce", approved), {
      [timeline]: [posts([draft])],
    });
    expect(reason(already.exit)).toBe(
      "Already posted: https://x.com/allthingswebdev/status/190",
    );
    const none = await run((a) => a.post(slug, "announce", approved), reads, {
      stored: null,
    });
    expect(reason(none.exit)).toBe(
      "No X sign-in is stored: run bun run social x-sign-in --from-xurl first. Nothing was posted.",
    );
    for (const { requests, stored } of [stale, already, none]) {
      expect(requests.map((r) => new URL(r.url).pathname)).toEqual([timeline]);
      expect(stored.value).not.toBe("refresh-2");
    }
  });

  test("another account is refused, and its new sign-in still kept", async () => {
    const approved = await token();
    const { exit, stored, posted } = await run(
      (a) => a.post(slug, "announce", approved),
      {
        ...reads,
        "/2/oauth2/token": [tokens],
        "/2/users/me": [me("42", "someoneelse")],
      },
    );
    expect(reason(exit)).toBe(
      `The X sign-in is @someoneelse (42), not @allthingswebdev (${ourXAccount.id}): nothing was posted.`,
    );
    expect(stored.value).toBe("refresh-2");
    expect(posted).toEqual([]);
  });

  test("a new sign-in 1Password didn't keep posts nothing", async () => {
    const approved = await token();
    const { exit, posted } = await run(
      (a) => a.post(slug, "announce", approved),
      { ...reads, "/2/oauth2/token": [tokens], "/2/users/me": [me()] },
      { store: failingStore("refresh-1") },
    );
    expect(reason(exit)).toMatch(
      /^1Password didn't answer\. X has spent the stored sign-in and its new one wasn't kept, so nothing was posted\./,
    );
    expect(posted).toEqual([]);
  });

  test("never retries a post X didn't take", async () => {
    const approved = await token();
    const { exit, posted } = await run(
      (a) => a.post(slug, "announce", approved),
      {
        ...reads,
        "/2/oauth2/token": [tokens],
        "/2/users/me": [me()],
        "/2/tweets": [{ status: 503 }],
      },
    );
    expect(reason(exit)).toBe(
      "X refused the post: 503. It may still have gone out: read it again with --dry-run, which says if it did, before approving it again.",
    );
    expect(posted).toHaveLength(1);
  });

  test("a post X doesn't answer in 30 seconds may be out", async () => {
    const approved = await token();
    const { exit, posted } = await run(
      (a) => a.post(slug, "announce", approved),
      {
        ...reads,
        "/2/oauth2/token": [tokens],
        "/2/users/me": [me()],
        "/2/tweets": ["hang"],
      },
    );
    expect(reason(exit)).toBe(
      "X didn't answer the post in 30 seconds. It may still have gone out: read it again with --dry-run, which says if it did, before approving it again.",
    );
    expect(posted).toHaveLength(1);
  });

  test("a sign-in X doesn't answer posts nothing, and says how to sign in again", async () => {
    const approved = await token();
    const { exit, posted, stored } = await run(
      (a) => a.post(slug, "announce", approved),
      { ...reads, "/2/oauth2/token": ["drop"] },
    );
    expect(reason(exit)).toMatch(
      /^X didn't answer the sign-in, so nothing was posted. X may have spent the stored sign-in anyway/,
    );
    expect(posted).toEqual([]);
    expect(stored.value).toBe("refresh-1");
  });

  test("a sign-in X refuses posts nothing", async () => {
    const approved = await token();
    const { exit, posted } = await run(
      (a) => a.post(slug, "announce", approved),
      {
        ...reads,
        "/2/oauth2/token": [json({ error: "invalid_request" }, 400)],
      },
    );
    expect(reason(exit)).toBe(
      "X refused the sign-in: 400, so nothing was posted. X may have spent the stored sign-in anyway: if the next try is refused too, sign @allthingswebdev in again (xurl auth oauth2 --app allthings allthingswebdev), then bun run social x-sign-in --from-xurl.",
    );
    expect(posted).toEqual([]);
  });
});

describe("keeping xurl's sign-in", () => {
  const yaml = (expiration: number) => `apps:
  allthings:
    client_id: made-up
    client_secret: made-up
    redirect_uri: http://localhost:8080/callback
    oauth2_tokens:
      allthingswebdev:
        type: oauth2
        oauth2:
          access_token: xurl-access
          refresh_token: xurl-refresh
          expiration_time: ${expiration}
default_app: allthings
`;

  const adopt = async (
    expiration: number,
    replies: Record<string, ReadonlyArray<Reply>>,
  ) => {
    const fake = fakeLumaBy((url) => url.pathname, replies);
    const memory = XSignIn.memory(null);
    const exit = await Effect.runPromiseExit(
      fromXurl(yaml(expiration), "allthings", "allthingswebdev").pipe(
        Effect.flatMap(adoptSignIn),
        Effect.provide(
          Layer.mergeAll(
            memory.layer,
            X.layer.pipe(
              Layer.provide(Layer.mergeAll(fake.layer, configFrom(env))),
            ),
          ),
        ),
        Effect.provide(clockLayer),
      ),
    );
    return { exit, requests: fake.requests, stored: memory.stored };
  };

  // The test clock is 2026-10-03T19:00:00Z.
  const later = Date.parse("2026-10-03T21:00:00Z") / 1000;
  const earlier = Date.parse("2026-10-03T17:00:00Z") / 1000;

  test("keeps it once its access token shows it is our account", async () => {
    const { exit, requests, stored } = await adopt(later, {
      "/2/users/me": [me()],
    });
    expect(value(exit)).toEqual({ verified: true });
    expect(stored.value).toBe("xurl-refresh");
    expect(requests.map((r) => [r.url, r.authorization])).toEqual([
      ["https://api.x.com/2/users/me", "Bearer xurl-access"],
    ]);
  });

  test("refuses another account's", async () => {
    const { exit, stored } = await adopt(later, {
      "/2/users/me": [me("42", "someoneelse")],
    });
    expect(reason(exit)).toMatch(/^The X sign-in is @someoneelse/);
    expect(stored.value).toBeNull();
  });

  test("keeps an expired one unchecked, spending nothing", async () => {
    const { exit, requests, stored } = await adopt(earlier, {});
    expect(value(exit)).toEqual({ verified: false });
    expect(stored.value).toBe("xurl-refresh");
    expect(requests).toEqual([]);
  });

  test("says when xurl has no sign-in for us", async () => {
    const exit = await Effect.runPromiseExit(
      fromXurl("apps:\n  allthings: {}\n", "allthings", "allthingswebdev"),
    );
    expect(reason(exit)).toBe(
      'xurl has no OAuth 2.0 sign-in for allthingswebdev on its app "allthings": run xurl auth oauth2 --app allthings allthingswebdev first.',
    );
  });
});

describe("the sign-in in 1Password", () => {
  test("is read and written through op, never on its command line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fake-op-"));
    try {
      const state = join(dir, "item.json");
      const log = join(dir, "calls.json");
      await Bun.write(
        state,
        JSON.stringify({
          id: "item-1",
          title: "allthings X app",
          fields: [{ id: "f1", label: "Client ID", value: "made-up" }],
        }),
      );
      await Bun.write(log, "[]");
      // A stand-in for op: `item get` prints the item, `item edit
      // --template` replaces it, and every call's arguments are logged
      // along with the template's mode.
      const op = join(dir, "op");
      await Bun.write(
        op,
        `#!/usr/bin/env bun
const [state, log] = [${JSON.stringify(state)}, ${JSON.stringify(log)}];
const args = Bun.argv.slice(2);
const calls = JSON.parse(await Bun.file(log).text());
const at = args.indexOf("--template");
const mode = at < 0 ? null : ((await import("node:fs")).statSync(args[at + 1]).mode & 0o777);
calls.push({ args, mode });
await Bun.write(log, JSON.stringify(calls));
if (args[1] === "get") process.stdout.write(await Bun.file(state).text());
else if (args[1] === "edit") await Bun.write(state, await Bun.file(args[at + 1]).text());
else process.exit(2);
`,
      );
      await chmod(op, 0o700);

      const use = <A, E>(effect: Effect.Effect<A, E, XSignIn>) =>
        Effect.runPromise(
          effect.pipe(
            Effect.provide(XSignIn.onePassword),
            Effect.provide(configFrom({ OP_BIN: op })),
          ),
        );

      expect(await use(XSignIn.use((s) => s.read))).toEqual(Option.none());
      await use(XSignIn.use((s) => s.write(Redacted.make("refresh-secret-1"))));
      await use(XSignIn.use((s) => s.write(Redacted.make("refresh-secret-2"))));
      const read = await use(XSignIn.use((s) => s.read));
      expect(Option.map(read, Redacted.value)).toEqual(
        Option.some("refresh-secret-2"),
      );

      const item = JSON.parse(await Bun.file(state).text()) as {
        fields: Array<{ label: string; type?: string }>;
      };
      expect(item.fields.map((f) => [f.label, f.type])).toEqual([
        ["Client ID", undefined],
        ["oauth2 refresh token", "CONCEALED"],
      ]);
      const calls = JSON.parse(await Bun.file(log).text()) as Array<{
        args: Array<string>;
        mode: number | null;
      }>;
      for (const call of calls) {
        expect(call.args.join(" ")).not.toContain("refresh-secret");
        expect(call.args).toContain("allthings");
      }
      const edits = calls.filter((call) => call.args[1] === "edit");
      expect(edits).toHaveLength(2);
      for (const edit of edits) {
        expect(edit.mode).toBe(0o600);
        const template = edit.args[edit.args.indexOf("--template") + 1] ?? "";
        expect(await stat(template).catch(() => null)).toBeNull();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
