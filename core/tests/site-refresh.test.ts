import { describe, expect, spyOn, test } from "bun:test";
import { ConfigProvider, Effect, Layer } from "effect";
import { refreshPath } from "../src/refresh-path.ts";
import { afterwards, tellSite } from "../src/site-refresh.ts";

/**
 * Telling the site after a command: what is sent, what is said on stderr,
 * that it never fails a command, and that every script connects through the
 * layer that does it.
 */

const token = "a-test-token-that-is-long-enough";
const neon =
  "postgres://studio:secret@ep-still-star-a6xwxqdz.us-west-2.aws.neon.tech/neondb";

/** Runs `effect` with `env` as its configuration, capturing stderr. */
async function withEnv(
  env: Record<string, string>,
  effect: Effect.Effect<void>,
): Promise<ReadonlyArray<string>> {
  const said: Array<string> = [];
  const spy = spyOn(console, "error").mockImplementation((...line) => {
    said.push(line.join(" "));
  });
  try {
    await Effect.runPromise(
      effect.pipe(
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
      ),
    );
  } finally {
    spy.mockRestore();
  }
  return said;
}

/** What the fake site was sent. */
interface Sent {
  readonly url: string;
  readonly method: string | undefined;
  readonly authorization: string | null;
}

/** A site that answers `body` with `status`, and keeps what it was sent. */
function fakeSite(status = 200, body: unknown = { next: null }) {
  const sent: Array<Sent> = [];
  const fetch = (async (url: string | URL, init: RequestInit) => {
    sent.push({
      url: String(url),
      method: init.method,
      authorization: new Headers(init.headers).get("authorization"),
    });
    return Response.json(body, { status });
  }) as unknown as typeof globalThis.fetch;
  return { sent, fetch };
}

describe("tellSite", () => {
  test("posts to the site's refresh path with the token, and says what it answered", async () => {
    const site = fakeSite(200, {
      next: { version: "v2", from: "2026-11-02T02:01:15.000Z" },
    });
    const said = await withEnv(
      { SITE_REFRESH_TOKEN: token, SITE_ORIGIN: "https://site.test" },
      tellSite(site.fetch),
    );
    expect(site.sent).toEqual([
      {
        url: `https://site.test${refreshPath}`,
        method: "POST",
        authorization: `Bearer ${token}`,
      },
    ]);
    expect(said).toEqual([
      "https://site.test told: it shows the new data from 2026-11-02T02:01:15.000Z.",
    ]);
    expect(said.join("")).not.toContain(token);
  });

  test("tells allthings.dev unless told otherwise, and says when its data is current", async () => {
    const site = fakeSite();
    const said = await withEnv(
      { SITE_REFRESH_TOKEN: token },
      tellSite(site.fetch),
    );
    expect(site.sent[0]?.url).toBe(`https://allthings.dev${refreshPath}`);
    expect(said).toEqual(["https://allthings.dev told: its data is current."]);
  });

  test("never fails: a refusal or an unreachable site is said, and the command goes on", async () => {
    const refused = await withEnv(
      { SITE_REFRESH_TOKEN: "wrong" },
      tellSite(fakeSite(401, { error: "unauthorized" }).fetch),
    );
    const down = await withEnv(
      { SITE_REFRESH_TOKEN: token },
      tellSite((() =>
        Promise.reject(new Error("no route"))) as unknown as typeof fetch),
    );
    expect(refused).toEqual([
      "https://allthings.dev didn't take the word (401): a change shows within the hour.",
    ]);
    expect(down).toEqual([
      "The site couldn't be told: a change shows within the hour.",
    ]);
  });

  test("sends the token only over https, or http to this machine, and to the path whatever the origin ends with", async () => {
    const site = fakeSite();
    const refused = await withEnv(
      { SITE_REFRESH_TOKEN: token, SITE_ORIGIN: "http://site.test" },
      tellSite(site.fetch),
    );
    expect(refused).toEqual([
      "SITE_ORIGIN isn't an https origin, so the site wasn't told: a change shows within the hour.",
    ]);
    expect(site.sent).toEqual([]);
    await withEnv(
      { SITE_REFRESH_TOKEN: token, SITE_ORIGIN: "https://site.test/" },
      tellSite(site.fetch),
    );
    await withEnv(
      { SITE_REFRESH_TOKEN: token, SITE_ORIGIN: "http://127.0.0.1:8787" },
      tellSite(site.fetch),
    );
    expect(site.sent.map((sent) => sent.url)).toEqual([
      `https://site.test${refreshPath}`,
      `http://127.0.0.1:8787${refreshPath}`,
    ]);
  });

  test("without a token sends nothing, and says so only for a command on Neon", async () => {
    const site = fakeSite();
    expect(await withEnv({ DATABASE_URL: neon }, tellSite(site.fetch))).toEqual(
      [
        "https://allthings.dev wasn't told (no SITE_REFRESH_TOKEN): a change shows within the hour.",
      ],
    );
    expect(
      await withEnv(
        { DATABASE_URL: "postgres://postgres@127.0.0.1:5432/postgres" },
        tellSite(site.fetch),
      ),
    ).toEqual([]);
    expect(await withEnv({}, tellSite(site.fetch))).toEqual([]);
    expect(site.sent).toEqual([]);
  });

  test("runs when the layer's scope closes: a command's end", async () => {
    const said = await withEnv(
      { DATABASE_URL: neon },
      Effect.void.pipe(Effect.provide(Layer.fresh(afterwards))),
    );
    expect(said).toHaveLength(1);
  });
});

describe("the scripts", () => {
  const root = new URL("../", import.meta.url).pathname;
  /** Scripts that connect but must not tell the site, and why. */
  const quiet: Readonly<Record<string, string>> = {
    "scripts/migration-guard.ts": "CI's read of the migration record",
    "scripts/sync-rehearsal.ts": "a rehearsal that always rolls back",
  };

  test("connect through Database.scriptLayer, so each tells the site when it ends", async () => {
    const plain: Array<string> = [];
    for (const path of new Bun.Glob("scripts/*.ts").scanSync(root)) {
      const text = await Bun.file(`${root}${path}`).text();
      if (/\bDatabase\.layer\b/.test(text) && quiet[path] === undefined) {
        plain.push(path);
      }
    }
    expect(plain).toEqual([]);
  });

  test("the quiet ones still connect plainly", async () => {
    for (const path of Object.keys(quiet)) {
      expect(await Bun.file(`${root}${path}`).text()).toContain(
        "Database.layer",
      );
    }
  });
});
