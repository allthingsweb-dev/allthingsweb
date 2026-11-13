import { describe, expect, test } from "bun:test";
import {
  brandDiction,
  longestSentence,
  stockPhrases,
  voiceFindings,
} from "../src/voice.ts";

/** What each stock-phrase rule is for: a line that breaks it, and the plain line that says the same. */
const stock: ReadonlyArray<readonly [broken: string, plain: string]> = [
  ["Deploys are seamless now.", "Deploys take one command now."],
  ["This unlocks offline sync.", "Now it syncs offline."],
  ["Talks that elevate your craft.", "Talks on how they built it."],
  ["We leverage Postgres.", "We use Postgres."],
  ["We delve into indexes.", "We look at indexes."],
  ["A deep dive on queues.", "Three ways queues fail."],
  ["Let's dive in.", "First, the queue."],
  ["A game-changer for apps.", "Apps start in a tenth of the time."],
  ["Cutting-edge research.", "Research from June."],
  ["State-of-the-art models.", "Models from this year."],
  ["A world-class lineup.", "Four maintainers on stage."],
  ["It will revolutionize testing.", "Tests run in parallel now."],
  ["Supercharge your builds.", "Builds take half the time."],
  ["Tools that empower teams.", "Tools two people can run."],
  ["Real synergy between them.", "They ship one release together."],
  ["A robust parser.", "A parser that takes malformed input."],
  ["Our vibrant community.", "About 150 people came."],
  ["A tapestry of ideas.", "Six talks."],
  ["A testament to open source.", "Built in the open, by four people."],
  ["In the realm of databases.", "In databases."],
  ["In an ever-evolving field.", "In a field that changed in June."],
  ["In today's world, agents matter.", "Agents write half our code."],
  ["The AI landscape keeps moving.", "Three labs shipped models in June."],
  ["Navigate the complexity of auth.", "Set up auth."],
  ["Harness the power of types.", "Use types."],
  ["Embark on a new project.", "Start a new project."],
  ["We're thrilled to announce a party.", "We're throwing a party."],
  ["Don't miss it.", "It's Tuesday at six."],
  ["Stay tuned.", "More on Monday."],
  [
    "Whether you're a beginner or an expert, come.",
    "Come if you build software.",
  ],
  ["Not just a meetup, but a movement.", "An evening of talks."],
  ["More than just talks.", "Talks, then a party."],
  ["It's not a conference, it's a party.", "It's a party."],
  ["An incredibly fast build.", "A build in two seconds."],
  ["An amazing night.", "A night of five talks."],
  ["The speakers — all of them — ship.", "The speakers all ship."],
];

describe("our voice", () => {
  test("each stock phrase is found, and its plain version passes", () => {
    for (const [broken, plain] of stock) {
      expect({ broken, found: voiceFindings(broken).length > 0 }).toEqual({
        broken,
        found: true,
      });
      expect({ plain, findings: voiceFindings(plain) }).toEqual({
        plain,
        findings: [],
      });
    }
  });

  test("every stock-phrase rule has a line here that breaks it", () => {
    for (const { pattern } of stockPhrases) {
      expect({
        pattern: String(pattern),
        tested: stock.some(([broken]) => pattern.test(broken)),
      }).toEqual({ pattern: String(pattern), tested: true });
    }
  });

  test("the brand's words: people say they're in, and hosts host", () => {
    for (const broken of [
      "RSVP on Luma.",
      "Register now.",
      "Sign up here.",
      "Thanks to our sponsors.",
      "Tonight!",
      "Tonight 🎉",
    ]) {
      expect(voiceFindings(broken, brandDiction).length).toBe(1);
    }
    expect(voiceFindings("Say you're in on Luma. Hosted at Sentry.")).toEqual(
      [],
    );
  });

  test("typographic apostrophes and phrases wrapped across lines are found too", () => {
    for (const broken of [
      "Don’t miss it.",
      "Whether you’re an expert or not.",
      "It’s not a conference, it’s a party.",
      "In today’s world.",
      "A deep\ndive on queues.",
    ]) {
      expect({ broken, found: voiceFindings(broken).length > 0 }).toEqual({
        broken,
        found: true,
      });
    }
    // A blank line parts two paragraphs, so their words never make one phrase.
    expect(
      voiceFindings("The water is deep\n\nDive teams train here."),
    ).toEqual([]);
    expect(
      voiceFindings("Not just a meetup\n\nin town, but a movement."),
    ).toEqual([]);
    expect(
      voiceFindings("Not just a meetup\n \nin town, but a movement."),
    ).toEqual([]);
    expect(
      voiceFindings("Not just a meetup\nin town, but a movement.").length,
    ).toBe(1);
  });

  test("Windows line endings part paragraphs and wrap lines as newlines do", () => {
    const words = (n: number) =>
      Array.from({ length: n }, () => "word").join(" ");
    expect(
      voiceFindings("The water is deep\r\n\r\nDive teams train here."),
    ).toEqual([]);
    expect(
      voiceFindings("Not just a meetup\r\n\r\nin town, but a movement."),
    ).toEqual([]);
    expect(voiceFindings("A deep\r\ndive on queues.").length).toBe(1);
    expect(voiceFindings(`${words(30)}.\r\n\r\n${words(30)}.`)).toEqual([]);
  });

  test("names what was said and why", () => {
    expect(voiceFindings("We leverage Postgres.")).toEqual([
      { why: "filler: say use", said: "leverage" },
    ]);
  });

  test("a sentence past the longest we write is found, and a list line is its own sentence", () => {
    const long = `${Array.from({ length: longestSentence + 1 }, () => "word").join(" ")}.`;
    expect(voiceFindings(long)).toEqual([
      {
        why: `a sentence of ${longestSentence + 1} words: split it (${longestSentence} at most)`,
        said: `${long.slice(0, 60)}…`,
      },
    ]);
    const atMost = Array.from({ length: longestSentence }, () => "word").join(
      " ",
    );
    expect(voiceFindings(`${atMost}.\n\n${atMost}.\n- ${atMost}`)).toEqual([]);
  });

  test("a sentence is counted whole, however it is wrapped, and a semicolon doesn't end it", () => {
    const words = (n: number) =>
      Array.from({ length: n }, () => "word").join(" ");
    const wrapped = `${words(20)}\n${words(21)}.`;
    expect(voiceFindings(wrapped).map(({ why }) => why)).toEqual([
      `a sentence of 41 words: split it (${longestSentence} at most)`,
    ]);
    const clauses = `${words(21)}; And ${words(20)}.`;
    expect(voiceFindings(clauses).map(({ why }) => why)).toEqual([
      `a sentence of 42 words: split it (${longestSentence} at most)`,
    ]);
    expect(voiceFindings(`${words(30)}.\n\n${words(30)}.`)).toEqual([]);
    expect(voiceFindings(`- ${words(30)}\n- ${words(30)}`)).toEqual([]);
    expect(
      voiceFindings(
        `“${words(30)}.”\nThe ${words(29)}.\n(${words(30)}.)\nAnd ${words(29)}.`,
      ),
    ).toEqual([]);
    expect(voiceFindings(`${words(30)}. 2026 ${words(30)}.`)).toEqual([]);
    expect(voiceFindings(`${words(30)}.\nhttps://allthings.dev/talks`)).toEqual(
      [],
    );
    const link = `[${words(11)}](https://allthings.dev/talks)`;
    expect(voiceFindings(`${words(30)}.\n${link}`)).toEqual([]);
    expect(
      voiceFindings(`${words(30)}.\n<https://allthings.dev/talks>`),
    ).toEqual([]);
  });
});
