import { describe, expect, test } from "claude-code/testing";

import { GLOW, NIGHT } from "../hooks/palette";
import {
  AT,
  BAND,
  elementsOf,
  MCP_JSON,
  SESSION,
  SUMMARY,
  textOf,
  world,
} from "./fixtures";

const SURFACES = ["terminal", "desktop"] as const;
const MINUTE = 60_000;

describe("the next evening's band", () => {
  test("none: with no evening ahead, the band is Claude Code's", async ($, on) => {
    const w = world(on, { site: { upcoming: [] }, now: AT.upcoming });
    await $.session.start(SESSION);
    await w.clock.advance(1);
    expect(w.requests).toEqual([
      {
        url: "https://allthings.dev/mcp",
        tool: "list_events",
        args: { when: "upcoming", limit: 1 },
      },
    ]);
    const ui = await $.ui.mount({ ...BAND, surface: "terminal" });
    expect(await ui.find({ key: "band" })).toBeUndefined();
    expect(await ui.find({ text: "drawn by Claude Code" })).toBeDefined();
  });

  test("none: offline, it fails quietly with no band and no toast", async ($, on) => {
    const w = world(on, {
      site: { upcoming: [SUMMARY], isDown: true },
      now: AT.upcoming,
    });
    await $.session.start(SESSION);
    await w.clock.advance(1);
    const ui = await $.ui.mount({ ...BAND, surface: "terminal" });
    expect(await ui.find({ key: "band" })).toBeUndefined();
    expect(w.toasts).toEqual([]);
  });

  test("upcoming: date · allthings/<topic>_ · neighborhood · host, and I'm in, on Night", async ($, on) => {
    const w = world(on, { site: { upcoming: [SUMMARY] }, now: AT.upcoming });
    await $.session.start(SESSION);
    await w.clock.advance(1);
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...BAND, surface });
      const band = await ui.find({ key: "band" });
      expect(band?.props).toMatchObject({ backgroundColor: NIGHT });
      expect(textOf(band)).toBe(
        "thu oct 15 · 5:30pm · allthings/agent-setups_ · FiDi · hosted at SentryI'm in →",
      );
      expect(await ui.find({ key: "imin" })).toMatchObject({
        type: "Button",
        props: { label: "I'm in →" },
      });
      const slash = elementsOf(band).find((element) => textOf(element) === "/");
      expect(slash?.props).toMatchObject({ color: GLOW });
      await ui.unmount();
    }
  });

  test("upcoming: the cursor blinks once a second", async ($, on) => {
    const w = world(on, { site: { upcoming: [SUMMARY] }, now: AT.upcoming });
    await $.session.start(SESSION);
    await w.clock.advance(1);
    const ui = await $.ui.mount({ ...BAND, surface: "terminal" });
    expect(textOf(await ui.find({ key: "band" }))).toContain("agent-setups_");
    await w.clock.advance(500);
    expect(textOf(await ui.find({ key: "band" }))).toContain(
      "agent-setups  · FiDi",
    );
    await w.clock.advance(500);
    expect(textOf(await ui.find({ key: "band" }))).toContain("agent-setups_");
  });

  test("upcoming: a narrow band drops the host, then the neighborhood", async ($, on) => {
    const w = world(on, { site: { upcoming: [SUMMARY] }, now: AT.upcoming });
    await $.session.start(SESSION);
    await w.clock.advance(1);
    const at = async (bodyColumns: number) => {
      const ui = await $.ui.mount({
        ...BAND,
        surface: "terminal",
        props: { ...BAND.props, bodyColumns },
      });
      const text = textOf(await ui.find({ key: "band" }));
      await ui.unmount();
      return text;
    };
    expect(await at(70)).toBe(
      "thu oct 15 · 5:30pm · allthings/agent-setups_ · FiDiI'm in →",
    );
    expect(await at(50)).toBe(
      "thu oct 15 · 5:30pm · allthings/agent-setups_I'm in →",
    );
  });

  test("today: a countdown in place of the date, moving with the clock", async ($, on) => {
    const w = world(on, { site: { upcoming: [SUMMARY] }, now: AT.today });
    await $.session.start(SESSION);
    await w.clock.advance(1);
    const before = await $.ui.mount({ ...BAND, surface: "terminal" });
    expect(textOf(await before.find({ key: "band" }))).toStartWith(
      "tonight · in 4h 30m · allthings/agent-setups_",
    );
    // Off screen while the half hour passes, so its blinks draw nothing.
    await before.unmount();
    await w.clock.advance(30 * MINUTE);
    const after = await $.ui.mount({ ...BAND, surface: "terminal" });
    expect(textOf(await after.find({ key: "band" }))).toStartWith(
      "tonight · in 4h · allthings/agent-setups_",
    );
  });

  test("live: during the evening, live now in Glow", async ($, on) => {
    const w = world(on, {
      site: { upcoming: [{ ...SUMMARY, status: "live" }] },
      now: AT.live,
    });
    await $.session.start(SESSION);
    await w.clock.advance(1);
    const ui = await $.ui.mount({ ...BAND, surface: "terminal" });
    const band = await ui.find({ key: "band" });
    expect(textOf(band)).toStartWith("live now · allthings/agent-setups_");
    const live = elementsOf(band).find(
      (element) => textOf(element) === "live now",
    );
    expect(live?.props).toMatchObject({ color: GLOW, bold: true });
  });

  test("after the evening, the band goes and the next one is asked for", async ($, on) => {
    // An evening that ends five minutes from now.
    const ending = {
      ...SUMMARY,
      endsAt: new Date(AT.live + 5 * MINUTE).toISOString(),
    };
    const w = world(on, { site: { upcoming: [ending] }, now: AT.live });
    await $.session.start(SESSION);
    await w.clock.advance(1);
    await w.clock.advance(11 * MINUTE);
    const ui = await $.ui.mount({ ...BAND, surface: "terminal" });
    expect(await ui.find({ key: "band" })).toBeUndefined();
    expect(
      w.requests.filter((request) => request.tool === "list_events").length,
    ).toBeGreaterThan(1);
  });

  test("after-click: I'm in opens the Luma page, and the band says see you at/<topic>", async ($, on) => {
    const w = world(on, { site: { upcoming: [SUMMARY] }, now: AT.upcoming });
    await $.session.start(SESSION);
    await w.clock.advance(1);
    const ui = await $.ui.mount({ ...BAND, surface: "terminal" });
    await ui.press({ key: "imin" });
    expect(w.opened).toEqual([["open", SUMMARY.rsvpUrl]]);
    const band = await ui.find({ key: "band" });
    expect(textOf(band)).toBe(
      "thu oct 15 · 5:30pm · allthings/agent-setups_ · FiDi · hosted at Sentrysee you at/agent-setups",
    );
    expect(await ui.find({ key: "imin" })).toBeUndefined();
    expect(w.stored.get("clicked")).toEqual([SUMMARY.slug]);
  });

  test("after-click: a later session remembers", async ($, on) => {
    const w = world(on, {
      site: { upcoming: [SUMMARY] },
      now: AT.upcoming,
      stored: { clicked: [SUMMARY.slug] },
    });
    await $.session.start(SESSION);
    await w.clock.advance(1);
    const ui = await $.ui.mount({ ...BAND, surface: "terminal" });
    expect(textOf(await ui.find({ key: "band" }))).toEndWith(
      "see you at/agent-setups",
    );
  });

  test("a survey has the band to itself", async ($, on) => {
    const w = world(on, { site: { upcoming: [SUMMARY] }, now: AT.upcoming });
    await $.session.start(SESSION);
    await w.clock.advance(1);
    const ui = await $.ui.mount({
      ...BAND,
      surface: "terminal",
      props: { ...BAND.props, hasSurvey: true },
    });
    expect(await ui.find({ key: "band" })).toBeUndefined();
  });
});

describe("the band's data", () => {
  test("refreshes about every 30 minutes, not more", async ($, on) => {
    const w = world(on, { site: { upcoming: [SUMMARY] }, now: AT.upcoming });
    await $.session.start(SESSION);
    await w.clock.advance(1);
    expect(w.requests).toHaveLength(1);
    await w.clock.advance(29 * MINUTE);
    expect(w.requests).toHaveLength(1);
    await w.clock.advance(2 * MINUTE);
    expect(w.requests).toHaveLength(2);
  });

  test("a headless run asks the site nothing until a command does", async ($, on) => {
    const w = world(on, { site: { upcoming: [SUMMARY] }, now: AT.upcoming });
    await $.session.start({ ...SESSION, isInteractive: false });
    await w.clock.advance(60 * MINUTE);
    expect(w.requests).toEqual([]);
  });

  test("a fresh cache from the store draws at once, with no request", async ($, on) => {
    const w = world(on, {
      site: { upcoming: [SUMMARY] },
      now: AT.upcoming,
      stored: { next: { raw: SUMMARY, fetchedAt: AT.upcoming - 10 * MINUTE } },
    });
    await $.session.start(SESSION);
    const ui = await $.ui.mount({ ...BAND, surface: "terminal" });
    expect(textOf(await ui.find({ key: "band" }))).toContain(
      "allthings/agent-setups_",
    );
    await w.clock.advance(1);
    expect(w.requests).toEqual([]);
  });

  test("offline, a cache from the last two hours keeps the band", async ($, on) => {
    const w = world(on, {
      site: { upcoming: [SUMMARY], isDown: true },
      now: AT.upcoming,
      stored: { next: { raw: SUMMARY, fetchedAt: AT.upcoming - 60 * MINUTE } },
    });
    await $.session.start(SESSION);
    await w.clock.advance(1);
    const ui = await $.ui.mount({ ...BAND, surface: "terminal" });
    expect(await ui.find({ key: "band" })).toBeDefined();
  });

  test("offline, an older cache goes quiet", async ($, on) => {
    const w = world(on, {
      site: { upcoming: [SUMMARY], isDown: true },
      now: AT.upcoming,
      stored: {
        next: { raw: SUMMARY, fetchedAt: AT.upcoming - 3 * 60 * MINUTE },
      },
    });
    await $.session.start(SESSION);
    await w.clock.advance(1);
    const ui = await $.ui.mount({ ...BAND, surface: "terminal" });
    expect(await ui.find({ key: "band" })).toBeUndefined();
  });

  test("a store that can't be written doesn't cost the band", async ($, on) => {
    const w = world(on, {
      site: { upcoming: [SUMMARY] },
      now: AT.upcoming,
      isStoreDown: true,
    });
    await $.session.start(SESSION);
    await w.clock.advance(1);
    const ui = await $.ui.mount({ ...BAND, surface: "terminal" });
    expect(textOf(await ui.find({ key: "band" }))).toContain(
      "allthings/agent-setups_",
    );
    await ui.press({ key: "imin" });
    expect(textOf(await ui.find({ key: "band" }))).toEndWith(
      "see you at/agent-setups",
    );
  });

  test("comes from the plugin's configured MCP URL, so it moves with the config", async ($, on) => {
    // A local server in place of the site, as a developer points the config.
    const moved = MCP_JSON.replace(
      "https://allthings.dev/mcp",
      "http://localhost:8787/mcp",
    );
    const w = world(on, {
      site: { upcoming: [SUMMARY] },
      now: AT.upcoming,
      mcpJson: moved,
    });
    await $.session.start(SESSION);
    await w.clock.advance(1);
    expect(w.requests.map((request) => request.url)).toEqual([
      "http://localhost:8787/mcp",
    ]);
  });

  test("/clear keeps the band, from what the store holds", async ($, on) => {
    world(on, {
      site: { upcoming: [SUMMARY] },
      now: AT.upcoming,
      stored: { next: { raw: SUMMARY, fetchedAt: AT.upcoming - MINUTE } },
    });
    await $.classic.SessionStart({ source: "clear" });
    const ui = await $.ui.mount({ ...BAND, surface: "terminal" });
    expect(textOf(await ui.find({ key: "band" }))).toContain(
      "allthings/agent-setups_",
    );
  });
});
