import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Layer } from "effect";
import { approvalToken } from "../src/approval.ts";
import { Promo } from "../src/promo/promo.ts";
import { DiscordAnnounce } from "../src/social/announce-discord.ts";
import { Discord } from "../src/social/discord.ts";
import { SentPosts } from "../src/social/sent-posts.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";
import { configFrom, fakeLumaBy, type Reply, settle } from "./support/luma.ts";

/**
 * Sending to our Discord through its channel webhook (src/social/), with
 * the webhook faked as discord.com/developers/docs documents it and every
 * request recorded: nothing here reaches Discord. The evening is
 * tests/seed.sql's React at Acme; the record is planning.sent_posts.
 */

const db = await seededDatabase();
afterAll(() => db.close());
beforeEach(() => db.exec("DELETE FROM planning.sent_posts"));

const slug = "2026-08-12-react-at-acme";
const secret = "made-up-webhook-token_0123456789";
const webhookUrl = `https://discord.com/api/webhooks/1400000000000000001/${secret}`;
const webhookBody: Reply = {
  body: JSON.stringify({
    type: 1,
    id: "1400000000000000001",
    name: "allthings studio",
    guild_id: "1100000000000000001",
    channel_id: "1200000000000000001",
    token: secret,
  }),
};
const message = (id: string): Reply => ({
  body: JSON.stringify({ id, channel_id: "1200000000000000001" }),
});

const run = async <A, E>(
  f: (announce: DiscordAnnounce["Service"]) => Effect.Effect<A, E>,
  replies: {
    readonly webhook?: Reply;
    readonly send?: ReadonlyArray<Reply>;
    readonly message?: ReadonlyArray<Reply>;
  },
  env: Record<string, string> = { DISCORD_WEBHOOK_URL: webhookUrl },
) => {
  // GET the webhook reads it, POST ?wait=true sends, GET …/messages/<id> reads one back.
  const fake = fakeLumaBy(
    (url) =>
      url.pathname.includes("/messages/")
        ? "message"
        : url.search === "?wait=true"
          ? "send"
          : "webhook",
    {
      webhook: [replies.webhook ?? webhookBody],
      send: replies.send ?? [],
      message: replies.message ?? [],
    },
  );
  const layer = DiscordAnnounce.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Promo.layer,
        SentPosts.layer,
        Discord.layer.pipe(
          Layer.provide(Layer.mergeAll(fake.layer, configFrom(env))),
        ),
      ),
    ),
    Layer.provideMerge(sqlLayer(db)),
    Layer.provideMerge(clockLayer),
  );
  const exit = await Effect.runPromiseExit(
    settle(DiscordAnnounce.use(f)).pipe(Effect.provide(layer)),
  );
  return {
    exit,
    requests: fake.requests,
    sends: fake.requests.filter((r) => r.method === "POST"),
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
const recorded = async () =>
  (
    await db.query<{ status: string; message_id: string | null }>(
      "SELECT status, message_id FROM planning.sent_posts",
    )
  ).rows;

const token = async () =>
  value((await run((a) => a.prepare(slug, "dayOf"), {})).exit).token;

describe("the dry run", () => {
  test("makes the message from the draft, with where it goes and its token, reading only", async () => {
    const { exit, requests } = await run((a) => a.prepare(slug, "dayOf"), {});
    const prepared = value(exit);
    expect(prepared.message.content).toContain("see you at/react");
    expect(prepared.message.allowed_mentions).toEqual({ parse: [] });
    expect(prepared.webhook).toEqual({
      id: "1400000000000000001",
      name: "allthings studio",
      guildId: "1100000000000000001",
      channelId: "1200000000000000001",
    });
    expect(prepared.sent).toBeNull();
    expect(prepared.token).toBe(
      await Effect.runPromise(
        approvalToken({
          channel: "discord",
          webhook: "1400000000000000001",
          channelId: "1200000000000000001",
          slug,
          moment: "dayOf",
          message: prepared.message,
        }),
      ),
    );
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      `GET ${webhookUrl}`,
    ]);
    expect(await recorded()).toEqual([]);
    // Nothing it returns carries the webhook's secret.
    expect(JSON.stringify(prepared)).not.toContain(secret);
  });

  test("needs a webhook URL, and refuses one that isn't a Discord webhook's", async () => {
    const none = await run((a) => a.prepare(slug, "dayOf"), {}, {});
    expect(reason(none.exit)).toBe(
      "DISCORD_WEBHOOK_URL is not set: there is no channel to read or post to.",
    );
    const elsewhere = await run(
      (a) => a.prepare(slug, "dayOf"),
      {},
      { DISCORD_WEBHOOK_URL: `https://example.com/api/webhooks/1/${secret}` },
    );
    expect(reason(elsewhere.exit)).toBe(
      "DISCORD_WEBHOOK_URL is not a Discord channel webhook's URL.",
    );
    expect([...none.requests, ...elsewhere.requests]).toEqual([]);
    expect(reason(elsewhere.exit)).not.toContain(secret);
  });
});

describe("sending", () => {
  test("sends exactly what was approved, once, and records it", async () => {
    const approved = await token();
    const { exit, sends } = await run((a) => a.send(slug, "dayOf", approved), {
      send: [message("1300000000000000001")],
    });
    const sent = value(exit);
    expect(sent.url).toBe(
      "https://discord.com/channels/1100000000000000001/1200000000000000001/1300000000000000001",
    );
    expect(sends).toHaveLength(1);
    expect(sends[0]?.url).toBe(`${webhookUrl}?wait=true`);
    expect(JSON.parse(sends[0]?.body ?? "")).toEqual(sent.message);
    expect(sent.sent).toMatchObject({
      status: "sent",
      token: approved,
      messageId: "1300000000000000001",
      url: sent.url,
    });
    expect(await recorded()).toEqual([
      { status: "sent", message_id: "1300000000000000001" },
    ]);

    // From then on the dry run says so, and a second send never starts.
    const again = await run((a) => a.prepare(slug, "dayOf"), {});
    expect(value(again.exit).sent?.status).toBe("sent");
    const twice = await run((a) => a.send(slug, "dayOf", approved), {
      send: [message("1300000000000000002")],
    });
    expect(reason(twice.exit)).toBe(`Already sent: ${sent.url}`);
    expect(twice.sends).toEqual([]);
    // Another moment is its own message.
    const recap = await run((a) => a.prepare(slug, "recap"), {});
    expect(value(recap.exit).sent).toBeNull();
  });

  test("refuses a stale token, sending and recording nothing", async () => {
    const { exit, sends } = await run(
      (a) => a.send(slug, "dayOf", "0000000000000000"),
      { send: [message("1300000000000000001")] },
    );
    expect(reason(exit)).toMatch(
      /^What would be sent has changed since 0000000000000000 was approved/,
    );
    expect(sends).toEqual([]);
    expect(await recorded()).toEqual([]);
  });

  test("two sends at once: one goes out", async () => {
    const approved = await token();
    const { exit, sends } = await run(
      (a) =>
        Effect.all(
          [a.send(slug, "dayOf", approved), a.send(slug, "dayOf", approved)],
          { concurrency: 2, mode: "result" },
        ),
      { send: [message("1300000000000000001")] },
    );
    const results = value(exit);
    expect(results.filter((r) => r._tag === "Success")).toHaveLength(1);
    expect(sends).toHaveLength(1);
    expect(await recorded()).toHaveLength(1);
  });

  test("a refusal lets go of the claim, so it can be sent once fixed", async () => {
    const approved = await token();
    const refused = await run((a) => a.send(slug, "dayOf", approved), {
      send: [{ status: 429, body: '{"retry_after": 2.5}' }],
    });
    expect(reason(refused.exit)).toBe(
      "Discord refused the message: 429: nothing was sent.",
    );
    expect(refused.sends).toHaveLength(1);
    expect(await recorded()).toEqual([]);
    const retried = await run((a) => a.send(slug, "dayOf", approved), {
      send: [message("1300000000000000001")],
    });
    expect(value(retried.exit).messageId).toBe("1300000000000000001");
  });

  for (const [what, reply, said] of [
    ["no answer", "drop", "Discord didn't answer the message"],
    ["a server error", { status: 502 }, "Discord failed the message: 502"],
    [
      "no answer in 30 seconds",
      "hang",
      "Discord didn't answer the message in 30 seconds",
    ],
  ] as const) {
    test(`${what} keeps the claim until an organizer settles it`, async () => {
      const approved = await token();
      const unanswered = await run((a) => a.send(slug, "dayOf", approved), {
        send: [reply],
      });
      expect(reason(unanswered.exit)).toBe(
        `${said}, so the message may be in the channel. Look in the channel: if it's there, record it with bun run social discord ${slug} --moment dayOf --sent <message id>; if it isn't, let go of it with bun run social discord ${slug} --moment dayOf --release, then approve it again.`,
      );
      expect(unanswered.sends).toHaveLength(1);
      expect(await recorded()).toEqual([
        { status: "unanswered", message_id: null },
      ]);

      // Never retried, nor sent again, until settled.
      const again = await run((a) => a.send(slug, "dayOf", approved), {
        send: [message("1300000000000000001")],
      });
      expect(reason(again.exit)).toMatch(
        /^A send of this message started at 2026-10-03T19:\d\d:\d\d\.000Z and was never answered/,
      );
      expect(again.sends).toEqual([]);

      const released = await run((a) => a.release(slug, "dayOf"), {});
      expect(value(released.exit).status).toBe("unanswered");
      expect(released.requests).toEqual([]);
      expect(await recorded()).toEqual([]);
      const nothing = await run((a) => a.release(slug, "dayOf"), {});
      expect(reason(nothing.exit)).toBe(
        `Nothing was started for ${slug}'s dayOf message: there is nothing to settle.`,
      );
    });
  }

  describe("a message an unanswered send left", () => {
    const leaveUnanswered = async () => {
      const approved = await token();
      await run((a) => a.send(slug, "dayOf", approved), { send: ["drop"] });
      return approved;
    };
    const content = async () =>
      value((await run((a) => a.prepare(slug, "dayOf"), {})).exit).message
        .content;

    test("is recorded once the webhook reads it back saying what was approved", async () => {
      const approved = await leaveUnanswered();
      const { exit, requests, sends } = await run(
        (a) => a.recordSent(slug, "dayOf", "1300000000000000009"),
        {
          message: [
            {
              body: JSON.stringify({
                id: "1300000000000000009",
                content: await content(),
              }),
            },
          ],
        },
      );
      expect(value(exit)).toMatchObject({
        status: "sent",
        token: approved,
        messageId: "1300000000000000009",
        url: "https://discord.com/channels/1100000000000000001/1200000000000000001/1300000000000000009",
      });
      expect(requests.map((r) => `${r.method} ${r.url}`)).toContain(
        `GET ${webhookUrl}/messages/1300000000000000009`,
      );
      expect(sends).toEqual([]);
      expect(await recorded()).toEqual([
        { status: "sent", message_id: "1300000000000000009" },
      ]);
    });

    test("is checked against what was approved, even once the draft has changed", async () => {
      const sentText = await content();
      const approved = await leaveUnanswered();
      await db.exec(
        "UPDATE events SET start_date = start_date + interval '1 hour' WHERE slug = '2026-08-12-react-at-acme'",
      );
      try {
        expect(await content()).not.toBe(sentText);
        const { exit } = await run(
          (a) => a.recordSent(slug, "dayOf", "1300000000000000009"),
          {
            message: [
              {
                body: JSON.stringify({
                  id: "1300000000000000009",
                  content: sentText,
                }),
              },
            ],
          },
        );
        expect(value(exit)).toMatchObject({ status: "sent", token: approved });
      } finally {
        await db.exec(
          "UPDATE events SET start_date = start_date - interval '1 hour' WHERE slug = '2026-08-12-react-at-acme'",
        );
      }
    });

    test("isn't recorded when it says something else, or the webhook didn't send it", async () => {
      const approved = await leaveUnanswered();
      const other = await run(
        (a) => a.recordSent(slug, "dayOf", "1300000000000000009"),
        {
          message: [
            {
              body: JSON.stringify({
                id: "1300000000000000009",
                content: "Hello",
              }),
            },
          ],
        },
      );
      expect(reason(other.exit)).toBe(
        `Message 1300000000000000009 doesn't say what was approved (${approved}), so it isn't this send: nothing was recorded.`,
      );
      const missing = await run(
        (a) => a.recordSent(slug, "dayOf", "1300000000000000008"),
        { message: [{ status: 404, body: '{"message": "Unknown Message"}' }] },
      );
      expect(reason(missing.exit)).toBe(
        "The webhook sent no message 1300000000000000008: copy the id from the message in the channel (Copy Message ID).",
      );
      const notAnId = await run(
        (a) => a.recordSent(slug, "dayOf", "../../tokens"),
        {},
      );
      expect(reason(notAnId.exit)).toMatch(/^The webhook sent no message/);
      expect(notAnId.requests.some((r) => r.url.includes("/messages/"))).toBe(
        false,
      );
      expect(await recorded()).toEqual([
        { status: "unanswered", message_id: null },
      ]);
    });
  });

  test("a send still going is neither released nor recorded, until it is abandoned", async () => {
    await db.exec(`INSERT INTO planning.sent_posts (channel, event_id, moment, token, claimed_at)
      SELECT 'discord', id, 'dayOf', '0123456789abcdef', '2026-10-03T18:58:00Z' FROM events WHERE slug = '${slug}'`);
    const going = await run((a) => a.release(slug, "dayOf"), {});
    expect(reason(going.exit)).toBe(
      "A send of this message started at 2026-10-03T18:58:00.000Z and is still going: wait for it, then read it again with --dry-run.",
    );
    const early = await run(
      (a) => a.recordSent(slug, "dayOf", "1300000000000000009"),
      {},
    );
    expect(reason(early.exit)).toMatch(/is still going/);
    // Five minutes after it was claimed, its process is taken to have died.
    await db.exec(
      "UPDATE planning.sent_posts SET claimed_at = '2026-10-03T18:54:00Z'",
    );
    const abandoned = await run((a) => a.release(slug, "dayOf"), {});
    expect(value(abandoned.exit).status).toBe("sending");
    expect(await recorded()).toEqual([]);
  });

  test("a sent message is never released", async () => {
    const approved = await token();
    const sent = value(
      (
        await run((a) => a.send(slug, "dayOf", approved), {
          send: [message("1300000000000000001")],
        })
      ).exit,
    );
    const { exit } = await run((a) => a.release(slug, "dayOf"), {});
    expect(reason(exit)).toBe(`Already sent: ${sent.url}`);
    expect(await recorded()).toHaveLength(1);
  });

  test("an unknown evening is refused before anything is read or sent", async () => {
    const { exit, requests } = await run(
      (a) => a.send("no-such-evening", "dayOf", "0000000000000000"),
      {},
    );
    expect(reason(exit)).toBe(
      'No published evening has the slug "no-such-evening".',
    );
    expect(requests).toEqual([]);
  });
});
