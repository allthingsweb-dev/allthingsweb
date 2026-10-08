import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Layer } from "effect";
import { approvalToken } from "../src/approval.ts";
import {
  avatarFile,
  Calendar,
  calendarChanges,
  calendarSentences,
  comparable,
  wantedCalendar,
} from "../src/luma/calendar.ts";
import { siteOrigin } from "../src/luma/publish.ts";
import { LumaWrite, type ManagedCalendar } from "../src/luma/write.ts";
import { socials, xHandle } from "../../web/src/links.ts";
import { configFrom, fakeLumaBy, type Reply, settle } from "./support/luma.ts";

/**
 * The Luma calendar in the brand (src/luma/calendar.ts): what it should
 * say, held to the foundations, the tokens and the site's links, and
 * changing exactly the approved fields, against a fake Luma that answers
 * as docs.luma.com documents. Nothing here reaches Luma.
 */

const key = "test-luma-key";
const oldAvatar =
  "https://images.lumacdn.com/calendars/ad/b1016146-d14f-4d5c-b537-5a4e249fbd00";

const calendarNow: ManagedCalendar = {
  id: "cal-3AAimKnRVQEId4r",
  name: "All Things Web",
  slug: "allthingsweb",
  url: "https://luma.com/allthingsweb",
  description: "Web dev events in the San Francisco Bay Area",
  avatar_url: oldAvatar,
  cover_image_url: "https://images.lumacdn.com/calendar-cover-images/aa/x",
  social_image_url: "https://images.lumacdn.com/calendar-cover-images/mz/y",
  tint_color: "#682FFF",
  website: "https://allthingsweb.dev",
  instagram_handle: null,
  twitter_handle: "ReactBayArea",
  youtube_handle: null,
  tiktok_handle: null,
  linkedin_handle: null,
};

/** The calendar once it says everything. */
const calendarDone: ManagedCalendar = {
  ...calendarNow,
  ...wantedCalendar,
  // Luma keeps some fields its own way; they still read as the same.
  tint_color: "#c0362c",
  website: "https://allthings.dev/",
  youtube_handle: "@allthingsweb-dev",
  linkedin_handle: "/company/all-things-web-dev",
  avatar_url: "https://images.lumacdn.com/calendars/zz/new",
};

const json = (value: unknown): Reply => ({ body: JSON.stringify(value) });
const icon = new Uint8Array(await Bun.file(avatarFile).arrayBuffer());

const run = async <A, E>(
  f: (calendar: Calendar["Service"]) => Effect.Effect<A, E>,
  replies: Record<string, ReadonlyArray<Reply>>,
) => {
  const luma = fakeLumaBy((url) => url.pathname, replies);
  const layer = Calendar.layer.pipe(
    Layer.provide(LumaWrite.layer),
    Layer.provide(
      Layer.mergeAll(luma.layer, configFrom({ LUMA_API_KEY: key })),
    ),
  );
  const exit = await Effect.runPromiseExit(
    settle(Calendar.use(f)).pipe(Effect.provide(layer)),
  );
  return { exit, requests: luma.requests };
};

const message = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) throw new Error("expected a failure");
  const error = Cause.squash(exit.cause);
  return error instanceof Error ? error.message : String(error);
};

const value = <A>(exit: Exit.Exit<A, unknown>): A => {
  if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
  return exit.value;
};

describe("what the calendar should say", () => {
  test("the foundations' two sentences, word for word", async () => {
    const foundations = await Bun.file(
      new URL("../../brand/foundations.md", import.meta.url),
    ).text();
    const quoted = foundations
      .split("\n")
      .filter((line) => line.startsWith("> "))
      .slice(0, 2)
      .map((line) => line.slice(2));
    expect(quoted).toEqual([...calendarSentences]);
    expect(wantedCalendar.description).toBe(calendarSentences.join(" "));
  });

  test("the slash's color, Bridge, as its tint", async () => {
    const tokens = await Bun.file(
      new URL("../../brand/all-things.tokens.json", import.meta.url),
    ).json();
    const bridge = `#${(tokens.color.bridge.$value.components as number[])
      .map((c) =>
        Math.round(c * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
    expect(wantedCalendar.tint_color.toLowerCase()).toBe(bridge.toLowerCase());
  });

  test("the site and the channels its footer lists", () => {
    const href = (name: string) =>
      socials.find((social) => social.name === name)?.href ?? "";
    expect(wantedCalendar.website).toBe(siteOrigin);
    expect(wantedCalendar.twitter_handle).toBe(xHandle);
    expect(href("youtube")).toBe(
      `https://www.youtube.com/@${wantedCalendar.youtube_handle}`,
    );
    expect(href("linkedin")).toBe(wantedCalendar.linkedin_handle);
  });
});

describe("what differs", () => {
  test("Luma's own way of keeping a value never reads as a change", () => {
    expect(comparable("twitter_handle", "@AllThingsWebDev")).toBe(
      "allthingswebdev",
    );
    expect(comparable("twitter_handle", "https://x.com/allthingswebdev")).toBe(
      "allthingswebdev",
    );
    expect(
      comparable("youtube_handle", "https://youtube.com/@allthingsweb-dev"),
    ).toBe("allthingsweb-dev");
    expect(
      comparable(
        "linkedin_handle",
        "https://www.linkedin.com/company/all-things-web-dev/",
      ),
    ).toBe("/company/all-things-web-dev");
    expect(comparable("website", "https://allthings.dev/")).toBe(
      "https://allthings.dev",
    );
    expect(comparable("tint_color", "#C0362C")).toBe("#c0362c");
    expect(comparable("name", " allthings ")).toBe("allthings");
  });

  test("each field that differs, from what to what; none once it says it all", () => {
    expect(calendarChanges(calendarNow, wantedCalendar)).toEqual([
      { field: "name", from: "All Things Web", to: "allthings" },
      {
        field: "description",
        from: "Web dev events in the San Francisco Bay Area",
        to: "Evenings for people who build software. In the neighborhoods of San Francisco.",
      },
      { field: "tint_color", from: "#682FFF", to: "#C0362C" },
      {
        field: "website",
        from: "https://allthingsweb.dev",
        to: "https://allthings.dev",
      },
      {
        field: "twitter_handle",
        from: "ReactBayArea",
        to: "allthingswebdev",
      },
      { field: "youtube_handle", from: null, to: "allthingsweb-dev" },
      {
        field: "linkedin_handle",
        from: null,
        to: "https://www.linkedin.com/company/all-things-web-dev/",
      },
    ]);
    expect(calendarChanges(calendarDone, wantedCalendar)).toEqual([]);
  });
});

describe("prepare", () => {
  test("reads the calendar and the avatar, and prints the token for exactly the changes", async () => {
    const { exit, requests } = await run((c) => c.prepare({}), {
      "/v1/calendars/get": [json(calendarNow)],
      "/calendars/ad/b1016146-d14f-4d5c-b537-5a4e249fbd00": [
        { body: new Uint8Array([1, 2, 3]) },
      ],
    });
    const prepared = value(exit);
    expect(prepared.changes.map((change) => change.field)).toEqual([
      "name",
      "description",
      "tint_color",
      "website",
      "twitter_handle",
      "youtube_handle",
      "linkedin_handle",
      "avatar_url",
    ]);
    expect(prepared.avatar.same).toBe(false);
    expect(prepared.byHand).toEqual({
      coverImageUrl: calendarNow.cover_image_url,
      socialImageUrl: calendarNow.social_image_url,
    });
    expect(prepared.token).toBe(
      await Effect.runPromise(
        approvalToken({
          calendarId: calendarNow.id,
          changes: prepared.changes,
          avatar: prepared.avatar.sha256,
        }),
      ),
    );
    expect(
      requests.map(
        (r) => `${r.method} ${new URL(r.url).pathname} ${r.apiKey ?? "-"}`,
      ),
    ).toEqual([
      `GET /v1/calendars/get ${key}`,
      // The avatar is public on Luma's CDN; the key never goes there.
      "GET /calendars/ad/b1016146-d14f-4d5c-b537-5a4e249fbd00 -",
    ]);
  });

  test("the address changes only when asked, and only to a slug's shape", async () => {
    const asked = await run((c) => c.prepare({ slug: "allthings" }), {
      "/v1/calendars/get": [json(calendarNow)],
      "/calendars/ad/b1016146-d14f-4d5c-b537-5a4e249fbd00": [{ body: icon }],
    });
    const prepared = value(asked.exit);
    expect(prepared.changes).toContainEqual({
      field: "slug",
      from: "allthingsweb",
      to: "allthings",
    });
    // Luma's avatar is the icon already: no change.
    expect(prepared.avatar.same).toBe(true);
    expect(prepared.changes.map((change) => change.field)).not.toContain(
      "avatar_url",
    );

    const bad = await run((c) => c.prepare({ slug: "All Things" }), {});
    expect(message(bad.exit)).toBe(
      "A calendar's address is lowercase letters, digits and hyphens: All Things",
    );
    expect(bad.requests).toEqual([]);
  });
});

describe("approve", () => {
  const replies = (after: ManagedCalendar) => ({
    "/v1/calendars/get": [json(calendarNow), json(after)],
    "/calendars/ad/b1016146-d14f-4d5c-b537-5a4e249fbd00": [
      { body: new Uint8Array([1, 2, 3]) },
    ],
    "/v1/images/create-upload-url": [
      json({
        upload_url: "https://upload.example/put/avatar",
        file_url: "https://images.lumacdn.com/calendars/zz/new",
      }),
    ],
    "/put/avatar": [{ status: 200 }],
    "/v1/calendars/update": [json({})],
  });

  const tokenFor = async () =>
    value(
      (
        await run((c) => c.prepare({}), {
          "/v1/calendars/get": [json(calendarNow)],
          "/calendars/ad/b1016146-d14f-4d5c-b537-5a4e249fbd00": [
            { body: new Uint8Array([1, 2, 3]) },
          ],
        })
      ).exit,
    ).token;

  test("uploads the avatar, sends one update with exactly the changes, and checks they took", async () => {
    const token = await tokenFor();
    const { exit, requests } = await run(
      (c) => c.approve(token, {}),
      replies(calendarDone),
    );
    value(exit);
    expect(
      requests.map((r) => `${r.method} ${new URL(r.url).pathname}`),
    ).toEqual([
      "GET /v1/calendars/get",
      "GET /calendars/ad/b1016146-d14f-4d5c-b537-5a4e249fbd00",
      "POST /v1/images/create-upload-url",
      "PUT /put/avatar",
      "POST /v1/calendars/update",
      "GET /v1/calendars/get",
    ]);
    expect(JSON.parse(requests[4]?.body ?? "")).toEqual({
      calendar_id: calendarNow.id,
      name: "allthings",
      description:
        "Evenings for people who build software. In the neighborhoods of San Francisco.",
      tint_color: "#C0362C",
      website: "https://allthings.dev",
      twitter_handle: "allthingswebdev",
      youtube_handle: "allthingsweb-dev",
      linkedin_handle: "https://www.linkedin.com/company/all-things-web-dev/",
      avatar_url: "https://images.lumacdn.com/calendars/zz/new",
    });
  });

  test("refuses a token for anything else, and changes nothing", async () => {
    const token = await tokenFor();
    const { exit, requests } = await run(
      (c) => c.approve(token, { slug: "allthings" }),
      replies(calendarDone),
    );
    expect(message(exit)).toStartWith(
      `What would change has changed since ${token} was approved`,
    );
    expect(requests.some((r) => r.method !== "GET")).toBe(false);
  });

  test("says which fields Luma didn't take", async () => {
    const token = await tokenFor();
    const { exit } = await run(
      (c) => c.approve(token, {}),
      replies({ ...calendarDone, name: "All Things Web" }),
    );
    expect(message(exit)).toBe(
      "Luma took the update, but these don't read as sent: name is All Things Web.",
    );
  });

  test("refuses when there is nothing to change", async () => {
    const done = {
      "/v1/calendars/get": [json(calendarDone)],
      "/calendars/zz/new": [{ body: icon }],
    };
    const token = value((await run((c) => c.prepare({}), done)).exit).token;
    const { exit, requests } = await run((c) => c.approve(token, {}), done);
    expect(message(exit)).toBe("Nothing to change: the calendar says it all.");
    expect(requests.some((r) => r.method !== "GET")).toBe(false);
  });
});
