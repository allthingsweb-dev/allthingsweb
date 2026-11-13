import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  clock,
  coach,
  Coaching,
  finishBy,
  limits,
  type Goal,
  readTalk,
  readTranscript,
  rules,
  slidesOf,
  type TalkMaterials,
  TalkMaterials as TalkMaterialsSchema,
} from "../src/coaching.ts";

/** Coaching for a talk (src/coaching.ts): every rule, both ways, and the whole. */

const openFloor = { format: "open-floor", minutes: 3 } as const;
const lineup = { format: "talk", minutes: 20 } as const;

/** `count` words of plain speech. */
const words = (count: number): string =>
  Array.from({ length: count }, () => "word").join(" ");

/** A WebVTT transcript: one cue per line of text, `every` seconds apart. */
function vtt(lines: ReadonlyArray<string>, every = 5): string {
  const stamp = (total: number) =>
    `00:${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}.000`;
  return [
    "WEBVTT",
    "",
    ...lines.flatMap((line, index) => [
      `${stamp(index * every)} --> ${stamp((index + 1) * every)}`,
      line,
      "",
    ]),
  ].join("\n");
}

const finding = (materials: TalkMaterials, id: string) =>
  coach(materials).findings.find((each) => each.id === id);

const strength = (materials: TalkMaterials, id: string) =>
  coach(materials).strengths.find((each) => each.id === id);

const unchecked = (materials: TalkMaterials, id: string) =>
  coach(materials).unchecked.find((each) => each.id === id);

describe("reading a transcript", () => {
  test("WebVTT: cues with their times, without headers, notes or voice tags", () => {
    const spoken = readTranscript(
      [
        "WEBVTT",
        "",
        "NOTE recorded on a phone",
        "",
        "1",
        "00:00:01.000 --> 00:00:04.500",
        "<v Speaker>Hi, I'm Sam.</v>",
        "",
        "00:05.000 --> 00:09.250",
        "I built a <b>thing</b>.",
      ].join("\n"),
    );
    expect(spoken.cues).toEqual([
      { start: 1, end: 4.5, text: "Hi, I'm Sam." },
      { start: 5, end: 9.25, text: "I built a thing ." },
    ]);
    expect(spoken.text).toBe("Hi, I'm Sam. I built a thing .");
  });

  test("SRT: comma decimals, numbered cues, Windows line ends", () => {
    const spoken = readTranscript(
      "1\r\n00:00:00,000 --> 00:00:02,000\r\nHello\r\nthere\r\n\r\n2\r\n00:01:00,500 --> 00:01:02,000\r\nBye\r\n",
    );
    expect(spoken.cues).toEqual([
      { start: 0, end: 2, text: "Hello there" },
      { start: 60.5, end: 62, text: "Bye" },
    ]);
  });

  test("plain text has no cues", () => {
    expect(readTranscript("Hi.\n\nI'm  Sam.")).toEqual({
      cues: null,
      text: "Hi. I'm Sam.",
    });
  });

  test("a talk's length: from its timestamps, else at 150 words a minute", () => {
    expect(
      readTalk({ slot: openFloor, transcript: vtt(["a", "b", "c"], 10) })
        .seconds,
    ).toBe(30);
    expect(readTalk({ slot: openFloor, transcript: words(300) }).seconds).toBe(
      120,
    );
    expect(readTalk({ slot: openFloor, transcript: "  " }).seconds).toBeNull();
  });

  test("overlapping cues: the talk ends at the latest end, not the last cue's", () => {
    const transcript = [
      "WEBVTT",
      "",
      "00:00.000 --> 03:20.000",
      "A long cue.",
      "",
      "00:05.000 --> 00:10.000",
      "A short one inside it.",
    ].join("\n");
    expect(readTalk({ slot: openFloor, transcript }).seconds).toBe(200);
    expect(
      coach({ slot: openFloor, transcript }).findings.find(
        (f) => f.id === "length",
      )?.severity,
    ).toBe("must");
  });

  test("hours past two digits aren't a timestamp, so every length fits its schema", () => {
    const transcript = "00:00.000 --> 9999999999999:00:00.000\nHello";
    expect(readTranscript(transcript).cues).toBeNull();
    expect(() =>
      Schema.decodeUnknownSync(Coaching)(
        coach({ slot: openFloor, transcript }),
      ),
    ).not.toThrow();
    expect(
      readTalk({
        slot: openFloor,
        transcript: "00:00.000 --> 99:59:59.999\nHello",
      }).seconds,
    ).toBe(359_999 + 1);
  });

  test("cues are read by when they start, inline timestamps included", () => {
    const transcript = [
      "WEBVTT",
      "",
      "00:00.000 --> 03:20.000",
      "<00:30.000>Later words.",
      "",
      "00:05.000 --> 00:10.000",
      "Hi, I'm Sam and I built X.",
    ].join("\n");
    expect(readTranscript(transcript).cues?.map((cue) => cue.start)).toEqual([
      5, 30,
    ]);
    // From the first words at 0:05 to the latest end at 3:20.
    expect(readTalk({ slot: openFloor, transcript }).seconds).toBe(195);
    expect(
      coach({ slot: openFloor, transcript }).findings.find(
        (f) => f.id === "length",
      )?.severity,
    ).toBe("must");
  });

  test("timestamps inside a cue split it into the parts said from then", () => {
    expect(
      readTranscript(
        "WEBVTT\n\n00:00.000 --> 00:30.000\nHello. <00:25.000>I'm Sam and I built X.\n",
      ).cues,
    ).toEqual([
      { start: 0, end: 25, text: "Hello." },
      { start: 25, end: 30, text: "I'm Sam and I built X." },
    ]);
  });

  test("reads text past its limits in linear time", () => {
    const started = performance.now();
    for (const transcript of [
      `00:00.000 --> 00:01.000\n${"<".repeat(limits.transcript)}`,
      `00:00.000 --> 00:01.000\n${"a".repeat(limits.transcript)}`,
      "\n".repeat(limits.transcript),
    ]) {
      coach({
        slot: openFloor,
        transcript,
        outline: "\n ".repeat(limits.outline / 2),
        goals: ["teach-a-technique", "find-contributors", "get-hired"],
      });
    }
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("reading slides", () => {
  test("parts between --- lines, front matter aside", () => {
    expect(
      slidesOf("---\ntheme: default\n---\n# One\n\n---\n\n# Two\n---\n# Three"),
    ).toEqual(["# One", "# Two", "# Three"]);
  });

  test("an outline without --- lines isn't slides", () => {
    expect(slidesOf("# One\n## Two\n- a point")).toBeNull();
    expect(slidesOf("---\n# Only one\n")).toBeNull();
  });
});

describe("length", () => {
  test("over the slot is a must: the timer cuts you off", () => {
    const over = finding(
      { slot: openFloor, transcript: vtt([words(10)], 200) },
      "length",
    );
    expect(over?.severity).toBe("must");
    expect(over?.observed).toBe("Your rehearsal runs 3:20, in a 3:00 slot.");
    expect(over?.advice).toContain("finish by 2:40");
    expect(over?.advice).toContain("the screen goes to the timer");
  });

  test("past 90% of the slot leaves no room", () => {
    expect(
      finding({ slot: openFloor, transcript: words(430) }, "length")?.severity,
    ).toBe("should");
  });

  test("under half the slot is room to spare", () => {
    expect(
      finding({ slot: lineup, transcript: words(1000) }, "length"),
    ).toMatchObject({ severity: "consider" });
  });

  test("inside the slot, with room, passes", () => {
    expect(
      strength({ slot: openFloor, transcript: words(375) }, "length")?.observed,
    ).toBe("About 2:30 at 150 words a minute (375 words), in a 3:00 slot.");
  });

  test("needs a transcript", () => {
    expect(unchecked({ slot: openFloor, title: "A" }, "length")).toEqual({
      id: "length",
      needs: "a rehearsal's transcript",
    });
  });

  test("finishing by 90% of a slot, on a 5-second mark", () => {
    expect(clock(finishBy(openFloor))).toBe("2:40");
    expect(clock(finishBy(lineup))).toBe("18:00");
  });
});

describe("pace", () => {
  test("fast is a should, slow a consider, between passes", () => {
    const at = (perCue: number) =>
      coach({
        slot: openFloor,
        transcript: vtt(
          Array.from({ length: 12 }, () => words(perCue)),
          10,
        ),
      });
    expect(at(32).findings.find((f) => f.id === "pace")).toMatchObject({
      severity: "should",
      observed: "192 words a minute.",
    });
    expect(at(15).findings.find((f) => f.id === "pace")?.severity).toBe(
      "consider",
    );
    expect(at(25).strengths.find((s) => s.id === "pace")?.observed).toBe(
      "150 words a minute.",
    );
  });

  test("needs timestamps", () => {
    expect(
      unchecked({ slot: openFloor, transcript: words(300) }, "pace")?.needs,
    ).toBe("a transcript with timestamps (WebVTT or SRT)");
  });
});

describe("opening", () => {
  test("who you are and what you built, in the first 20 seconds", () => {
    expect(
      strength(
        {
          slot: openFloor,
          transcript: vtt(["Hi, I’m Sam.", "I built a tiny database."]),
        },
        "opening",
      ),
    ).toBeDefined();
  });

  test("words timed past 20 seconds inside a long cue don't count", () => {
    // An inline timestamp places them; without one, a cue's words are read
    // as said evenly across it.
    for (const cue of [
      "Hello there. <00:25.000>I'm Sam and I built X.",
      `${words(30)} I'm Sam and I built X.`,
    ]) {
      expect(
        finding(
          {
            slot: openFloor,
            transcript: `WEBVTT\n\n00:00.000 --> 00:40.000\n${cue}\n`,
          },
          "opening",
        )?.severity,
      ).toBe("should");
    }
  });

  test("said after 20 seconds doesn't count", () => {
    const late = finding(
      {
        slot: openFloor,
        transcript: vtt([
          "So.",
          "Okay.",
          "Let's see.",
          "Right.",
          "Hi, I'm Sam and I built this.",
        ]),
      },
      "opening",
    );
    expect(late).toMatchObject({
      severity: "should",
      observed:
        "Your first 20 seconds don't say who you are or what you built.",
    });
  });

  test("one of the two is a consider", () => {
    expect(
      finding(
        { slot: openFloor, transcript: "Hi, I'm Sam. Today: databases." },
        "opening",
      ),
    ).toMatchObject({
      severity: "consider",
      observed: "Your first 20 seconds don't say what you built.",
    });
  });

  test("an outline's first slide stands in for a transcript", () => {
    expect(
      strength(
        { slot: openFloor, outline: "# I'm Sam\nI built kv\n---\n# How" },
        "opening",
      )?.observed,
    ).toBe("Your outline's opening say who you are and what you built.");
  });
});

describe("no pitch", () => {
  test("prices, discounts and demos to book are a must", () => {
    const pitch = finding(
      {
        slot: openFloor,
        transcript:
          "Plans are $49/month, 20% off with promo code ATW. Book a demo! Book a demo.",
      },
      "no-pitch",
    );
    expect(pitch?.severity).toBe("must");
    expect(pitch?.observed).toBe(
      'Reads as a pitch: "book a demo" ×2, "$49/month", "20% off", "promo code".',
    );
  });

  test("asking for contact details is a must", () => {
    expect(
      finding(
        { slot: openFloor, transcript: "Drop your email at the door." },
        "no-pitch",
      )?.severity,
    ).toBe("must");
  });

  test("waitlists and a round are a should", () => {
    expect(
      finding(
        { slot: openFloor, abstract: "Join our waitlist. We're raising." },
        "no-pitch",
      ),
    ).toMatchObject({
      severity: "should",
      observed: 'Reads as a pitch: "join our waitlist", "we\'re raising".',
    });
  });

  test("where you work, open source and free packages pass", () => {
    expect(
      strength(
        {
          slot: openFloor,
          title: "A free, MIT-licensed queue",
          transcript:
            "I'm Sam, I work at Acme. It's open source and free on npm. When users sign up we write a row; pricing logic lives in one file.",
        },
        "no-pitch",
      )?.observed,
    ).toBe("Nothing to buy, book or sign up for.");
  });
});

describe("demo", () => {
  test("a demo without a recording to fall back on", () => {
    expect(
      finding({ slot: openFloor, outline: "Live demo of the CLI" }, "demo"),
    ).toMatchObject({ severity: "should" });
    expect(
      finding({ slot: lineup, outline: "Live demo of the CLI" }, "demo")
        ?.advice,
    ).toContain("ready to play offline");
  });

  test("a demo with a recording passes; no demo, no verdict", () => {
    expect(
      strength(
        { slot: openFloor, outline: "Demo, with a recorded backup" },
        "demo",
      ),
    ).toBeDefined();
    const none = coach({ slot: openFloor, outline: "Slides about a parser" });
    expect(none.findings.some((f) => f.id === "demo")).toBe(false);
    expect(none.strengths.some((s) => s.id === "demo")).toBe(false);
    expect(none.unchecked.some((u) => u.id === "demo")).toBe(false);
  });
});

describe("slides", () => {
  const deck = (count: number, each = 5) =>
    Array.from({ length: count }, () => words(each)).join("\n---\n");

  test("more than two a minute", () => {
    expect(
      finding({ slot: openFloor, outline: deck(9) }, "slide-count"),
    ).toMatchObject({
      severity: "should",
      observed: "9 slides in 3 minutes: 20 seconds a slide.",
    });
    expect(
      finding(
        { slot: { format: "talk", minutes: 3 }, outline: deck(9) },
        "slide-count",
      )?.severity,
    ).toBe("consider");
    expect(
      strength({ slot: openFloor, outline: deck(6) }, "slide-count"),
    ).toBeDefined();
  });

  test("slides over 40 words, by number", () => {
    const outline = [words(10), words(41), words(5), words(60)].join("\n---\n");
    expect(finding({ slot: openFloor, outline }, "slide-words")).toMatchObject({
      severity: "should",
      observed: "Slides 2, 4 carry more than 40 words (the most is 60).",
    });
    expect(
      strength({ slot: openFloor, outline: deck(3) }, "slide-words")?.observed,
    ).toBe("The busiest slide has 5 words.");
  });

  test("need a deck", () => {
    expect(
      unchecked({ slot: openFloor, outline: "just notes" }, "slide-count"),
    ).toBeDefined();
  });
});

describe("where to find it", () => {
  test("the ending names a repo, a link or a handle", () => {
    for (const ending of [
      "It's at github.com/sam/kv.",
      "Slides are on my site, sam.dev.",
      "Find me @sam.",
    ]) {
      expect(
        strength(
          { slot: openFloor, transcript: `${words(200)} ${ending}` },
          "where-to-find",
        ),
      ).toBeDefined();
    }
  });

  test("a link only at the start doesn't count", () => {
    expect(
      finding(
        {
          slot: openFloor,
          transcript: `See github.com/sam/kv. ${words(200)} Thanks!`,
        },
        "where-to-find",
      )?.severity,
    ).toBe("should");
  });
});

describe("fillers", () => {
  test("counted a minute, the most common named", () => {
    const transcript = `${"um ".repeat(20)}you know you know ${words(276)}`;
    expect(finding({ slot: openFloor, transcript }, "filler")).toMatchObject({
      severity: "should",
      observed: '22 fillers, 11 a minute; most often "um".',
    });
    expect(
      finding(
        { slot: openFloor, transcript: `${"uh ".repeat(8)}${words(292)}` },
        "filler",
      )?.severity,
    ).toBe("consider");
    expect(
      strength({ slot: openFloor, transcript: words(300) }, "filler")?.observed,
    ).toBe("No fillers.");
  });
});

describe("title and abstract", () => {
  test("a talk without a title is a must; an open floor's, a consider", () => {
    expect(finding({ slot: lineup }, "title")?.severity).toBe("must");
    expect(finding({ slot: openFloor }, "title")?.severity).toBe("consider");
  });

  test("a long title is a consider", () => {
    expect(
      finding({ slot: openFloor, title: words(13) }, "title")?.severity,
    ).toBe("consider");
    expect(
      strength({ slot: openFloor, title: "Typed errors" }, "title"),
    ).toEqual({ id: "title", observed: "A 2-word title." });
  });

  test("an abstract only for a talk in the lineup", () => {
    expect(finding({ slot: lineup }, "abstract")?.severity).toBe("should");
    expect(
      finding({ slot: lineup, abstract: words(151) }, "abstract")?.severity,
    ).toBe("consider");
    const open = coach({ slot: openFloor });
    expect(
      [...open.findings, ...open.strengths].some((x) => x.id === "abstract"),
    ).toBe(false);
  });
});

describe("goals", () => {
  const withGoal = (goal: Goal, materials: Omit<TalkMaterials, "goals">) =>
    coach({ ...materials, goals: [goal] });

  test("only the goals named are checked", () => {
    const ids = coach({ slot: openFloor, outline: "x" }).findings.map(
      (f) => f.id,
    );
    for (const rule of rules.filter((r) => r.goal !== null)) {
      expect(ids).not.toContain(rule.id);
    }
  });

  test("first talk: rehearse out loud", () => {
    expect(
      withGoal("first-talk", { slot: openFloor }).findings.find(
        (f) => f.id === "first-talk",
      )?.severity,
    ).toBe("should");
    expect(
      withGoal("first-talk", {
        slot: openFloor,
        transcript: "hi",
      }).strengths.some((s) => s.id === "first-talk"),
    ).toBe(true);
  });

  test("teach a technique: steps or code", () => {
    // A numbered list after a heading: the pattern keeps its line flag.
    for (const outline of ["1. Install\n2. Configure", "# Setup\n1. Install"]) {
      expect(
        withGoal("teach-a-technique", {
          slot: openFloor,
          outline,
        }).strengths.some((s) => s.id === "teach-a-technique"),
      ).toBe(true);
    }
    expect(
      withGoal("teach-a-technique", {
        slot: openFloor,
        outline: "Why queues matter",
      }).findings.some((f) => f.id === "teach-a-technique"),
    ).toBe(true);
  });

  test("find contributors: the repo and a first issue", () => {
    const found = withGoal("find-contributors", {
      slot: openFloor,
      outline: "Help wanted",
    });
    expect(found.findings.map((f) => f.id)).toContain("find-contributors-repo");
    expect(found.strengths.map((s) => s.id)).toContain(
      "find-contributors-issue",
    );
    const both = withGoal("find-contributors", {
      slot: openFloor,
      outline: "github.com/sam/kv, start with #12",
    });
    expect(both.strengths.map((s) => s.id)).toEqual(
      expect.arrayContaining([
        "find-contributors-repo",
        "find-contributors-issue",
      ]),
    );
  });

  test("show a launch: show it working", () => {
    expect(
      withGoal("show-a-launch", {
        slot: openFloor,
        outline: "Features: a, b, c",
      }).findings.some((f) => f.id === "show-a-launch"),
    ).toBe(true);
    expect(
      withGoal("show-a-launch", {
        slot: openFloor,
        outline: "Demo of v2",
      }).strengths.some((s) => s.id === "show-a-launch"),
    ).toBe(true);
  });

  test("get hired: your own part, in the first person", () => {
    expect(
      withGoal("get-hired", {
        slot: openFloor,
        transcript: "We built a cache.",
      }).findings.some((f) => f.id === "get-hired"),
    ).toBe(true);
    expect(
      withGoal("get-hired", {
        slot: openFloor,
        transcript: "I rewrote the cache.",
      }).strengths.some((s) => s.id === "get-hired"),
    ).toBe(true);
  });
});

describe("the coaching", () => {
  const sample: TalkMaterials = {
    slot: openFloor,
    title: "A database in a weekend",
    outline: "Live demo\n---\nBook a demo at our site",
    transcript: vtt(
      Array.from({ length: 40 }, (_, i) =>
        i === 0 ? "So um yeah." : words(12),
      ),
    ),
    goals: ["find-contributors", "find-contributors"],
  };

  test("findings most pressing first, then in the rules' order", () => {
    const { findings } = coach(sample);
    const order = (id: string) => rules.findIndex((rule) => rule.id === id);
    const rank = { must: 0, should: 1, consider: 2 } as const;
    for (const [a, b] of findings.slice(1).map((f, i) => [findings[i], f])) {
      if (a === undefined || b === undefined) continue;
      expect(
        rank[a.severity] < rank[b.severity] ||
          (rank[a.severity] === rank[b.severity] && order(a.id) < order(b.id)),
      ).toBe(true);
    }
    expect(findings.slice(0, 2).map((f) => f.id)).toEqual([
      "length",
      "no-pitch",
    ]);
  });

  test("the summary leads with the first three findings' advice", () => {
    const coaching = coach(sample);
    expect(coaching.summary).toEqual(
      coaching.findings.slice(0, 3).map((f) => f.advice),
    );
  });

  test("measures what it read, and names each goal once", () => {
    const coaching = coach(sample);
    expect(coaching.goals).toEqual(["find-contributors"]);
    expect(coaching.measures).toEqual({
      words: 471,
      timed: true,
      seconds: 200,
      wordsPerMinute: 141,
      fillersPerMinute: 0.3,
      slides: 2,
      mostWordsOnASlide: 6,
    });
  });

  test("nothing to change: says so, and what else it could check", () => {
    const coaching = coach({
      slot: openFloor,
      title: "Typed errors",
      outline: "I'm Sam and I built typed errors. Code at github.com/sam/te",
    });
    expect(coaching.findings).toEqual([]);
    expect(coaching.summary).toEqual([
      "Nothing to change in what you sent. See you on stage.",
      "Send a rehearsal's transcript, or a transcript with timestamps (WebVTT or SRT), or slides, separated by lines of --- to check more.",
    ]);
  });

  test("the same materials get the same coaching", () => {
    expect(coach(sample)).toEqual(coach(sample));
  });

  test("matches its schema, and the materials theirs", () => {
    expect(() =>
      Schema.decodeUnknownSync(Coaching)(coach(sample)),
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TalkMaterialsSchema)(sample),
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TalkMaterialsSchema)({
        slot: { format: "open-floor", minutes: 0 },
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TalkMaterialsSchema)({
        slot: openFloor,
        goals: ["sell-things"],
      }),
    ).toThrow();
  });

  test("every rule has its own id and says what good looks like", () => {
    const ids = rules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of rules) {
      expect(rule.good.length).toBeGreaterThan(0);
      expect(rule.why.length).toBeGreaterThan(0);
    }
  });
});
