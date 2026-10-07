import { describe, expect, test } from "claude-code/testing";

import { BRIDGE, GLOW } from "../hooks/palette";
import { AT, elementsOf, SESSION, textOf, toolRow, world } from "./fixtures";

const site = { upcoming: [] };

/** Each tool's call, and the row the slash grammar draws for it. */
const ROWS: readonly (readonly [tool: string, input: unknown, row: string])[] =
  [
    ["Read", { file_path: "/work/src/app.ts" }, "read/src/app.ts"],
    [
      "Read",
      { file_path: "/work/src/app.ts", offset: 10, limit: 50 },
      "read/src/app.ts (lines 10–59)",
    ],
    [
      "Edit",
      { file_path: "/work/home.tsx", old_string: "a", new_string: "b" },
      "edit/home.tsx",
    ],
    [
      "Edit",
      {
        file_path: "/work/home.tsx",
        old_string: "a",
        new_string: "b",
        replace_all: true,
      },
      "edit/home.tsx (every match)",
    ],
    [
      "MultiEdit",
      { file_path: "/work/home.tsx", edits: [{}, {}] },
      "edit/home.tsx (2 edits)",
    ],
    ["Write", { file_path: "/work/notes.md", content: "hi" }, "write/notes.md"],
    [
      "NotebookEdit",
      { notebook_path: "/work/a.ipynb", cell_id: "c1", new_source: "x" },
      "edit/a.ipynb (cell c1)",
    ],
    ["Bash", { command: "bun test" }, "bash/bun test"],
    [
      "Bash",
      { command: "bun run dev", run_in_background: true },
      "bash/bun run dev (in the background)",
    ],
    ["Grep", { pattern: "curation" }, 'search/"curation"'],
    [
      "Grep",
      { pattern: "curation", path: "/work/src", glob: "*.ts" },
      'search/"curation" (in src · *.ts)',
    ],
    ["Glob", { pattern: "**/*.tsx" }, "find/**/*.tsx"],
    [
      "WebFetch",
      { url: "https://allthings.dev/", prompt: "what's next" },
      "fetch/allthings.dev",
    ],
    [
      "WebFetch",
      { url: "https://www.allthings.dev/events?when=all" },
      "fetch/allthings.dev/events?when=all",
    ],
    ["WebSearch", { query: "sf meetups" }, 'search/"sf meetups" (the web)'],
    [
      "Agent",
      {
        description: "Find the venue table",
        prompt: "…",
        subagent_type: "Explore",
      },
      "agent/Find the venue table (Explore)",
    ],
    ["Skill", { skill: "find-evenings" }, "skill/find-evenings"],
    ["TodoWrite", { todos: [{}, {}, {}] }, "todo/3 items"],
    [
      "mcp__plugin_allthings_allthings__list_events",
      { when: "upcoming", limit: 1 },
      "allthings/list_events (when: upcoming, limit: 1)",
    ],
    ["mcp__github__get_issue", { number: 7 }, "github/get_issue (number: 7)"],
    ["ExitPlanMode", { plan: "ship it" }, "exit-plan-mode/plan: ship it"],
  ];

describe("tool rows in the slash grammar", () => {
  for (const [tool, input, row] of ROWS) {
    test(`${tool} draws ${row}`, async ($, on) => {
      world(on, { site, now: AT.upcoming });
      await $.session.start(SESSION);
      const ui = await $.ui.mount(toolRow(tool, input));
      const drawn = await ui.find({ key: "row-toolu_1" });
      expect(textOf(drawn).replace("⏺ ", "")).toBe(row);
    });
  }

  test("the verb is lowercase and the slash is Glow on a dark theme", async ($, on) => {
    world(on, { site, now: AT.upcoming, theme: "dark" });
    await $.session.start(SESSION);
    const ui = await $.ui.mount(
      toolRow("Read", { file_path: "/work/src/app.ts" }),
    );
    const elements = elementsOf(await ui.find({ key: "row-toolu_1" }));
    const verb = elements.find((element) => textOf(element) === "read");
    const slash = elements.find((element) => textOf(element) === "/");
    expect(verb?.props).toMatchObject({ bold: true });
    expect(slash?.props).toMatchObject({ color: GLOW });
  });

  test("the slash is Bridge on a light theme, and on allthings paper", async ($, on) => {
    world(on, { site, now: AT.upcoming, theme: "custom:allthings-paper" });
    await $.session.start(SESSION);
    const ui = await $.ui.mount(toolRow("Bash", { command: "ls" }));
    const slash = elementsOf(await ui.find({ key: "row-toolu_1" })).find(
      (element) => textOf(element) === "/",
    );
    expect(slash?.props).toMatchObject({ color: BRIDGE });
  });

  test("the status dot keeps Claude Code's states", async ($, on) => {
    world(on, { site, now: AT.upcoming });
    await $.session.start(SESSION);
    const dotOf = async (state: Parameters<typeof toolRow>[2]) => {
      const ui = await $.ui.mount(toolRow("Bash", { command: "ls" }, state));
      const dot = elementsOf(await ui.find({ key: "row-toolu_1" })).find(
        (element) => textOf(element) === "⏺ ",
      );
      await ui.unmount();
      return dot?.props.color;
    };
    expect(await dotOf({ isRunning: true })).toBe("inactive");
    expect(await dotOf({})).toBe("success");
    expect(await dotOf({ isErrored: true })).toBe("error");
    expect(await dotOf({ isInterrupted: true })).toBe("error");
  });

  test("an interrupted call still says so", async ($, on) => {
    world(on, { site, now: AT.upcoming });
    await $.session.start(SESSION);
    const ui = await $.ui.mount(
      toolRow("Bash", { command: "sleep 60" }, { isInterrupted: true }),
    );
    expect(textOf(await ui.find({ key: "row-toolu_1" }))).toContain(
      "⎿  Interrupted",
    );
  });

  test("a running call's dot blinks with the cursor", async ($, on) => {
    const w = world(on, { site, now: AT.upcoming });
    on("turn.start", (_engine, e) => ({ turnId: e.turnId }));
    await $.session.start(SESSION);
    await $.turn.start({ text: "go", turnId: "t1" });
    const dimOf = async () => {
      const ui = await $.ui.mount(
        toolRow("Bash", { command: "bun test" }, { isRunning: true }),
      );
      const dot = elementsOf(await ui.find({ key: "row-toolu_1" })).find(
        (element) => textOf(element) === "⏺ ",
      );
      await ui.unmount();
      return dot?.props.dimColor;
    };
    expect(await dimOf()).toBe(false);
    await w.clock.advance(500);
    expect(await dimOf()).toBe(true);
  });

  test("the desktop's rows stay its own, with their expand and collapse", async ($, on) => {
    world(on, { site, now: AT.upcoming, surface: "desktop" });
    await $.session.start({ ...SESSION, surface: "desktop" });
    const ui = await $.ui.mount(
      toolRow("Read", { file_path: "/work/src/app.ts" }, {}, "desktop"),
    );
    expect(await ui.find({ text: "drawn by Claude Code" })).toBeDefined();
    expect(await ui.find({ key: "row-toolu_1" })).toBeUndefined();
  });

  test("a row in an expanded group, which carries its output, stays Claude Code's", async ($, on) => {
    world(on, { site, now: AT.upcoming });
    await $.session.start(SESSION);
    await $.ui.render({
      component: "ToolGroup",
      surface: "terminal",
      requestId: "group-1",
      props: {
        calls: [
          {
            tool_use_id: "toolu_1",
            tool: "Read",
            input: { file_path: "/work/a.ts" },
            isRunning: false,
            isErrored: false,
            isInterrupted: false,
          },
        ],
        isActive: false,
        isExpanded: true,
      },
    });
    const ui = await $.ui.mount(toolRow("Read", { file_path: "/work/a.ts" }));
    expect(await ui.find({ text: "drawn by Claude Code" })).toBeDefined();
  });
});
