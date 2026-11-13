import { describe, expect, test } from "bun:test";
import { run, type Io } from "../src/cli.ts";
import type { TalkToCoach } from "../src/client.ts";
import {
  headingOf,
  partOf,
  talkToCoach,
  type CoachOptions,
} from "../src/coach.ts";
import { CliError, ExitCode } from "../src/errors.ts";
import { formatCoaching } from "../src/format.ts";
import { coachingLimits } from "../src/schemas.ts";
import { coaching, fakeClient } from "./fixtures.ts";

/** `allthings coach`: files to coach_talk's input, and its answer printed. */

const none: CoachOptions = {
  slot: undefined,
  talk: false,
  goals: [],
  title: undefined,
  abstract: undefined,
};

const usageError = (thunk: () => unknown): string => {
  try {
    thunk();
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).exitCode).toBe(ExitCode.UsageError);
    return (error as CliError).message;
  }
  throw new Error("expected a usage error");
};

describe("reading a talk's files", () => {
  test("Markdown is the outline; text, WebVTT and SRT the transcript", () => {
    expect(partOf("slides.md")).toBe("outline");
    expect(partOf("notes.MARKDOWN")).toBe("outline");
    expect(partOf("rehearsal.txt")).toBe("transcript");
    expect(partOf("rehearsal.vtt")).toBe("transcript");
    expect(partOf("dir.v2/rehearsal.SRT")).toBe("transcript");
    expect(partOf("deck.pdf")).toBeUndefined();
    expect(partOf("README")).toBeUndefined();
  });

  test("an open floor's 3 minutes by default, the title from the first heading", () => {
    expect(
      talkToCoach(
        [
          {
            path: "slides.md",
            text: "---\ntheme: x\n---\n# A queue\n---\nDemo\n",
          },
          { path: "run.vtt", text: "WEBVTT\n\n00:00.000 --> 00:02.000\nHi\n" },
        ],
        none,
      ),
    ).toEqual({
      format: "open-floor",
      minutes: 3,
      title: "A queue",
      outline: "---\ntheme: x\n---\n# A queue\n---\nDemo",
      transcript: "WEBVTT\n\n00:00.000 --> 00:02.000\nHi",
    });
  });

  test("a talk is 20 minutes, and a slot over 5 minutes is a talk", () => {
    const outline = [{ path: "o.md", text: "x" }];
    expect(talkToCoach(outline, { ...none, talk: true })).toMatchObject({
      format: "talk",
      minutes: 20,
    });
    expect(talkToCoach(outline, { ...none, slot: "12" })).toMatchObject({
      format: "talk",
      minutes: 12,
    });
    expect(talkToCoach(outline, { ...none, slot: "5" })).toMatchObject({
      format: "open-floor",
      minutes: 5,
    });
  });

  test("goals once each; the title and abstract as given win", () => {
    const talk: TalkToCoach = talkToCoach(
      [{ path: "o.md", text: "# Heading" }],
      {
        ...none,
        goals: ["get-hired", "first-talk", "get-hired"],
        title: " Mine ",
        abstract: "What it is.",
      },
    );
    expect(talk).toEqual({
      format: "open-floor",
      minutes: 3,
      title: "Mine",
      abstract: "What it is.",
      outline: "# Heading",
      goals: ["get-hired", "first-talk"],
    });
  });

  test("refuses what coach_talk would, before sending anything", () => {
    expect(usageError(() => talkToCoach([], none))).toContain(
      `"coach" takes your talk's files`,
    );
    expect(
      usageError(() => talkToCoach([{ path: "deck.pdf", text: "" }], none)),
    ).toContain("deck.pdf isn't a file coach reads");
    expect(
      usageError(() =>
        talkToCoach(
          [
            { path: "a.md", text: "a" },
            { path: "b.md", text: "b" },
          ],
          none,
        ),
      ),
    ).toContain(
      "Send one file of an outline or slides: a.md and b.md both are.",
    );
    for (const slot of ["0", "61", "2.5", "three"]) {
      expect(
        usageError(() =>
          talkToCoach([{ path: "a.md", text: "a" }], { ...none, slot }),
        ),
      ).toContain("--slot must be a whole number of minutes from 1 to 60.");
    }
    expect(
      usageError(() =>
        talkToCoach([{ path: "a.md", text: "a" }], {
          ...none,
          goals: ["get-hird"],
        }),
      ),
    ).toContain(`"get-hird" isn't a goal. Did you mean "get-hired"?`);
    expect(
      usageError(() =>
        talkToCoach(
          [
            {
              path: "long.vtt",
              text: "x".repeat(coachingLimits.transcript + 1),
            },
          ],
          none,
        ),
      ),
    ).toBe(
      'long.vtt has 60,001 characters; coach takes a transcript of up to 60,000. Trim it, or send part of it.\nRun "allthings coach --help" for usage.',
    );
  });

  test("a deck's title is its first heading", () => {
    expect(headingOf("intro\n## Typed errors ##\n# Later")).toBe(
      "Typed errors",
    );
    expect(headingOf("no headings")).toBeUndefined();
  });
});

describe("printing coaching", () => {
  test("what to do first, each finding by how much it matters, what works", () => {
    const text = formatCoaching(coaching, false, "https://allthings.dev/coach");
    expect(text).toStartWith(
      "Coaching · open floor · 3 minutes · find contributors\n\nFirst\n  1. Cut 0:25",
    );
    expect(text).toContain(
      "Must\n  length                   Your rehearsal runs 3:05, in a 3:00 slot.\n                           Cut 0:25 to finish by 2:40.",
    );
    expect(text).toContain(
      "Should\n  find-contributors-issue  No first issue named.",
    );
    expect(text).toContain(
      "Working\n  no-pitch                 Nothing to buy, book or sign up for.",
    );
    expect(text).toContain(
      "Not checked\n  slide-count              needs slides, separated by lines of ---",
    );
    expect(text).not.toContain("Consider");
    expect(text).toEndWith(
      "Every check, and why: https://allthings.dev/coach\n",
    );
  });
});

describe("allthings coach", () => {
  async function exec(argv: string[], files: Record<string, string> = {}) {
    let stdout = "";
    let stderr = "";
    const sent: TalkToCoach[] = [];
    const io: Io = {
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
      isTTY: false,
      env: {},
      openUrl: async () => {},
      client: fakeClient({
        coachTalk: async (talk) => {
          sent.push(talk);
          return coaching;
        },
      }),
      readFile: async (path) => {
        const text = files[path];
        if (text === undefined) {
          throw Object.assign(new Error("no such file"), { code: "ENOENT" });
        }
        return text;
      },
    };
    const code = await run(argv, io);
    return { code, stdout, stderr, sent };
  }

  test("sends the files and prints the coaching", async () => {
    const { code, stdout, sent } = await exec(
      ["coach", "slides.md", "run.txt", "--goal", "find-contributors"],
      { "slides.md": "# A queue\n", "run.txt": "Hi, I'm Sam." },
    );
    expect(code).toBe(ExitCode.Ok);
    expect(sent).toEqual([
      {
        format: "open-floor",
        minutes: 3,
        title: "A queue",
        outline: "# A queue",
        transcript: "Hi, I'm Sam.",
        goals: ["find-contributors"],
      },
    ]);
    expect(stdout).toStartWith("Coaching · open floor · 3 minutes");
  });

  test("--json prints coach_talk's answer", async () => {
    const { stdout } = await exec(["coach", "o.md", "--json"], { "o.md": "x" });
    expect(JSON.parse(stdout)).toEqual(coaching);
  });

  test("a file it can't read is a usage error, and nothing is sent", async () => {
    const { code, stderr, sent } = await exec(["coach", "missing.md"]);
    expect(code).toBe(ExitCode.UsageError);
    expect(stderr).toContain("Can't read missing.md (ENOENT).");
    expect(sent).toEqual([]);
  });

  test("its options go with coach alone", async () => {
    for (const argv of [
      ["events", "--goal", "first-talk"],
      ["about", "--slot", "3"],
      ["--talk"],
    ]) {
      const { code, stderr } = await exec(argv);
      expect(code).toBe(ExitCode.UsageError);
      expect(stderr).toContain('go with "coach"');
    }
  });

  test("--help explains the files, goals and options", async () => {
    const { code, stdout } = await exec(["coach", "--help"]);
    expect(code).toBe(ExitCode.Ok);
    expect(stdout).toContain("allthings coach <files...>");
    expect(stdout).toContain(".txt, .vtt, .srt");
    expect(stdout).toContain(
      "first-talk, teach-a-technique, find-contributors, show-a-launch, get-hired",
    );
    expect(stdout).toContain("keeps none of what it is sent");
  });
});
