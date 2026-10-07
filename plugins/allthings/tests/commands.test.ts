import type { RenderInput } from "claude-code";
import { describe, expect, test } from "claude-code/testing";

import { BRIDGE, GLOW } from "../hooks/palette";
import {
  AT,
  BAND,
  elementsOf,
  EVENT,
  PLUGIN,
  SESSION,
  SUMMARY,
  textOf,
  typed,
  world,
} from "./fixtures";

const PAST = {
  ...SUMMARY,
  slug: "2026-06-26-all-things-effect",
  name: "Effect San Francisco 🇺🇸",
  status: "past",
  startsAt: "2026-07-01T00:30:00.000Z",
  endsAt: "2026-07-01T03:30:00.000Z",
  venue: {
    name: "CodeRabbit",
    address:
      "CodeRabbit, 201 Spear St 12th floor, San Francisco, CA 94105, USA",
  },
  recordingUrl: "https://www.youtube.com/watch?v=effect",
};

const site = {
  upcoming: [SUMMARY],
  events: { [SUMMARY.slug]: EVENT, [PAST.slug]: PAST },
};

/** The /at output row, as Claude Code hands it to the mod to draw. */
function atRow(
  args: string,
  text: string,
): RenderInput<"CommandOutput", "terminal"> & { plugin: string } {
  return {
    plugin: PLUGIN,
    component: "CommandOutput",
    surface: "terminal",
    requestId: "msg-1",
    props: { command: "at", args, text, isErrored: false },
  };
}

describe("/at and /imin", () => {
  test("both register at the session's start, to run mid-turn", async ($, on) => {
    const w = world(on, { site, now: AT.upcoming });
    await $.session.start(SESSION);
    expect(w.registered).toEqual(["at", "imin"]);
  });

  test("a name that's taken costs only that command", async ($, on) => {
    const w = world(on, { site, now: AT.upcoming, taken: ["at"] });
    await $.session.start(SESSION);
    expect(w.registered).toEqual(["imin"]);
  });

  test("/at prints the next evening's card, with who's on stage", async ($, on) => {
    const w = world(on, { site, now: AT.upcoming });
    await $.session.start(SESSION);
    const answer = await $.command.run(typed("at"));
    expect(answer.text).toBe(
      [
        "allthings/agent-setups_",
        "thu oct 15 · 5:30–8:30pm · FiDi · hosted at Sentry",
        "45 Fremont St",
        "· My agent setup, file by file — Ada Lovelace",
        `I'm in → ${SUMMARY.rsvpUrl}`,
        SUMMARY.url,
      ].join("\n"),
    );
    expect(w.requests.map((request) => request.tool)).toEqual([
      "list_events",
      "get_event",
    ]);
  });

  test("/at draws its row as a card: the slash in the theme's color, and links", async ($, on) => {
    world(on, { site, now: AT.upcoming, theme: "light" });
    await $.session.start(SESSION);
    const answer = await $.command.run(typed("at"));
    for (const surface of ["terminal", "desktop"] as const) {
      const ui = await $.ui.mount({ ...atRow("", answer.text ?? ""), surface });
      const card = await ui.find({ key: "card" });
      expect(textOf(card)).toContain("allthings/agent-setups_");
      const slash = elementsOf(card).find((element) => textOf(element) === "/");
      expect(slash?.props).toMatchObject({ color: BRIDGE });
      const links = elementsOf(card).filter(
        (element) => element.type === "Link",
      );
      expect(links.map((link) => link.props)).toEqual([
        { href: SUMMARY.rsvpUrl, label: "lu.ma/event/evt-agentsetups" },
        {
          href: SUMMARY.url,
          label: "allthings.dev/2026-10-15-all-things-agent-setups",
        },
      ]);
      await ui.unmount();
    }
  });

  test("/at <slug> shows any evening; a past one loses its cursor and links its recording", async ($, on) => {
    const w = world(on, { site, now: AT.upcoming });
    await $.session.start(SESSION);
    const answer = await $.command.run(typed("at", PAST.slug));
    expect(answer.text).toBe(
      [
        "allthings/effect",
        "tue jun 30 · 5:30–8:30pm · East Cut · hosted at CodeRabbit",
        "201 Spear St 12th floor",
        `recording → ${PAST.recordingUrl}`,
        PAST.url,
      ].join("\n"),
    );
    expect(w.requests.map((request) => request.tool)).toEqual(["get_event"]);
    const ui = await $.ui.mount(atRow(PAST.slug, answer.text ?? ""));
    expect(textOf(await ui.find({ key: "card" }))).toStartWith(
      "allthings/effect",
    );
  });

  test("/at <slug> for no evening says so", async ($, on) => {
    world(on, { site, now: AT.upcoming });
    await $.session.start(SESSION);
    const answer = await $.command.run(typed("at", "nope"));
    expect(answer.text).toBe("no evening at nope. /at shows the next one.");
  });

  test("two /at runs at once share one list_events request", async ($, on) => {
    const w = world(on, { site, now: AT.upcoming });
    await $.session.start({ ...SESSION, isInteractive: false });
    const [first, second] = await Promise.all([
      $.command.run(typed("at")),
      $.command.run(typed("at")),
    ]);
    expect(first.text).toBe(second.text);
    expect(
      w.requests.filter((request) => request.tool === "list_events"),
    ).toHaveLength(1);
  });

  test("/at with nothing ahead points at the site", async ($, on) => {
    world(on, { site: { upcoming: [] }, now: AT.upcoming });
    await $.session.start(SESSION);
    const answer = await $.command.run(typed("at"));
    expect(answer.text).toBe(
      "no evening on the calendar right now. https://allthings.dev has what's next.",
    );
  });

  test("/at offline says it couldn't reach the site", async ($, on) => {
    world(on, { site: { ...site, isDown: true }, now: AT.upcoming });
    await $.session.start(SESSION);
    const answer = await $.command.run(typed("at"));
    expect(answer.text).toBe(
      "couldn't reach allthings.dev just now. try again in a minute.",
    );
  });

  test("a row the mod drew no card for is Claude Code's", async ($, on) => {
    world(on, { site, now: AT.upcoming });
    await $.session.start(SESSION);
    const ui = await $.ui.mount(atRow("never-ran", "text"));
    expect(await ui.find({ text: "drawn by Claude Code" })).toBeDefined();
  });

  test("/imin opens the next evening's Luma page, and the band signs off", async ($, on) => {
    const w = world(on, { site, now: AT.upcoming });
    await $.session.start(SESSION);
    const answer = await $.command.run(typed("imin"));
    expect(w.opened).toEqual([["open", SUMMARY.rsvpUrl]]);
    expect(answer.text).toBe(
      "see you at/agent-setups · opened lu.ma/event/evt-agentsetups",
    );
    const ui = await $.ui.mount({ ...BAND, surface: "terminal" });
    const band = await ui.find({ key: "band" });
    expect(textOf(band)).toEndWith("see you at/agent-setups");
    const slash = elementsOf(band)
      .filter((element) => textOf(element) === "/")
      .map((element) => element.props.color);
    expect(slash).toEqual([GLOW, GLOW]);
  });

  test("/imin where no browser opens gives the link instead", async ($, on) => {
    const w = world(on, { site, now: AT.upcoming, opener: "none" });
    await $.session.start(SESSION);
    const answer = await $.command.run(typed("imin"));
    expect(answer.text).toBe(
      `see you at/agent-setups · say you're in at ${SUMMARY.rsvpUrl}`,
    );
    expect(w.toasts).toEqual([`I'm in → ${SUMMARY.rsvpUrl}`]);
  });

  test("/imin with nothing ahead says so", async ($, on) => {
    const w = world(on, { site: { upcoming: [] }, now: AT.upcoming });
    await $.session.start(SESSION);
    const answer = await $.command.run(typed("imin"));
    expect(answer.text).toBe(
      "no evening on the calendar right now. https://allthings.dev has what's next.",
    );
    expect(w.opened).toEqual([]);
  });
});
