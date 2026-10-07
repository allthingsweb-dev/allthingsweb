import type { On, RenderInput } from "claude-code";
import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import { phraseAt, seedOf } from "../hooks/city";
import { AT, SESSION, SUMMARY, textOf, world } from "./fixtures";

const SPINNER: RenderInput<"Spinner", "terminal"> = {
  component: "Spinner",
  surface: "terminal",
  requestId: "main",
  props: { word: "Sauteing", message: null, suffix: "…", mode: "thinking" },
};

/** Claude Code's spinner, as the props reach it: the word or message, then the suffix. */
function echoSpinner(on: On) {
  on("ui.render", { component: "Spinner" }, ($, e) => ({
    type: "Text",
    props: {},
    children: [`${e.props.message ?? e.props.word}${e.props.suffix}`],
  }));
  on("turn.start", ($, e) => ({ turnId: e.turnId }));
  on("turn.complete", () => ({ text: "" }));
}

async function frame(
  $: Engine,
  input: RenderInput<"Spinner"> = SPINNER,
): Promise<string> {
  return textOf(await $.ui.render(input));
}

describe("the spinner as the wordmark, wandering the city", () => {
  test("the first lines walk SoMa, the Mission, Dogpatch, the Tenderloin and FiDi", () => {
    expect([0, 1, 2, 3, 4].map(phraseAt)).toEqual([
      "shipping in SoMa",
      "pairing in the Mission",
      "debugging in Dogpatch",
      "refactoring in the Tenderloin",
      "deploying from FiDi",
    ]);
  });

  test("a turn's spinner reads allthings/_ and a working verb somewhere in the city", async ($, on) => {
    echoSpinner(on);
    world(on, { site: { upcoming: [] }, now: AT.upcoming });
    await $.session.start(SESSION);
    await $.turn.start({ text: "go", turnId: "t1" });
    expect(await frame($)).toBe(`allthings/_ ${phraseAt(seedOf("t1"))}…`);
  });

  test("the cursor blinks every half second while the turn runs", async ($, on) => {
    echoSpinner(on);
    const w = world(on, { site: { upcoming: [] }, now: AT.upcoming });
    await $.session.start(SESSION);
    await $.turn.start({ text: "go", turnId: "t1" });
    const phrase = phraseAt(seedOf("t1"));
    expect(await frame($)).toBe(`allthings/_ ${phrase}…`);
    await w.clock.advance(500);
    expect(await frame($)).toBe(`allthings/  ${phrase}…`);
    await w.clock.advance(500);
    expect(await frame($)).toBe(`allthings/_ ${phrase}…`);
  });

  test("the line moves to the next neighborhood every six seconds", async ($, on) => {
    echoSpinner(on);
    const w = world(on, { site: { upcoming: [] }, now: AT.upcoming });
    await $.session.start(SESSION);
    await $.turn.start({ text: "go", turnId: "t1" });
    await w.clock.advance(6_000);
    expect(await frame($)).toBe(`allthings/_ ${phraseAt(seedOf("t1") + 1)}…`);
  });

  test("nothing blinks once the turn is over and no evening is ahead", async ($, on) => {
    echoSpinner(on);
    const w = world(on, { site: { upcoming: [] }, now: AT.upcoming });
    await $.session.start(SESSION);
    await $.turn.start({ text: "go", turnId: "t1" });
    await $.turn.complete({
      turnId: "t1",
      answer: "done",
      durationMs: 1,
      isAborted: false,
      reason: "answer",
    });
    const before = await frame($);
    await w.clock.advance(500);
    expect(await frame($)).toBe(before);
  });

  test("with reduce motion on, the cursor stays solid", async ($, on) => {
    echoSpinner(on);
    const w = world(on, {
      site: { upcoming: [SUMMARY] },
      now: AT.upcoming,
      reduceMotion: true,
    });
    await $.session.start(SESSION);
    await $.turn.start({ text: "go", turnId: "t1" });
    await w.clock.advance(500);
    expect(await frame($)).toStartWith("allthings/_ ");
  });

  test("a state's message keeps its words, after the wordmark", async ($, on) => {
    echoSpinner(on);
    world(on, { site: { upcoming: [] }, now: AT.upcoming });
    await $.session.start(SESSION);
    const drawn = await frame($, {
      ...SPINNER,
      props: { ...SPINNER.props, message: "Compacting conversation" },
    });
    expect(drawn).toBe("allthings/_ · Compacting conversation…");
  });

  test("the desktop's word says what the step does, so it stays", async ($, on) => {
    echoSpinner(on);
    world(on, { site: { upcoming: [] }, now: AT.upcoming });
    await $.session.start({ ...SESSION, surface: "desktop" });
    const desktop = (word: string): RenderInput<"Spinner", "desktop"> => ({
      ...SPINNER,
      surface: "desktop",
      props: { ...SPINNER.props, word },
    });
    expect(await frame($, desktop("Creating notes.md"))).toBe(
      "allthings/_ · Creating notes.md…",
    );
    expect(await frame($, desktop("Working"))).toBe(
      `allthings/_ ${phraseAt(0)}…`,
    );
  });
});
