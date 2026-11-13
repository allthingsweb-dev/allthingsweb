import { afterAll, describe, expect, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { issueFiles } from "../letters/index.ts";
import { approvalToken } from "../src/approval.ts";
import { guideEntries } from "../src/guide.ts";
import {
  approvals,
  corpus,
  type Edit,
  editsOf,
  everyIssue,
  Issue,
  issueToken,
  itemsOf,
  letterBudget,
  letterFindings,
  letterWords,
  plainText,
  proseParts,
  publishedLetters,
  publishedOf,
  repeatsOfEdits,
  sourceFindings,
  sourceUrl,
  wordBudget,
  wordCount,
} from "../src/letter.ts";
import { voiceFindings } from "../src/voice.ts";
import { clockLayer, seededDatabase, sqlLayer } from "./support/database.ts";

/**
 * The allthings letter (src/letter.ts): its rules, each with an issue that
 * breaks it, and every issue in core/letters/ held to them.
 */

/** A sentence of `n` words, without its full stop. */
const words = (n: number) =>
  Array.from({ length: n }, (_, i) => (i === 0 ? "Word" : "word")).join(" ");

/** An issue that breaks no rule: two of the guide's entries and a closing. */
const good: Issue = {
  month: "2026-12",
  title: "Two trips for April",
  happenings: [
    {
      name: "React Miami",
      text: "Two days of talks in April, right after [AI Engineer Miami](https://www.ai.engineer/miami/2027).",
      source: { _tag: "guide", id: "react-miami" },
    },
    {
      name: "AI Engineer Miami",
      text: "The same week as React Miami, so one flight covers both.",
      source: { _tag: "guide", id: "ai-engineer-miami" },
    },
  ],
  closing:
    "Seven evenings so far this year, every one [on its page](https://allthings.dev/year/2026). See you at the next.",
};

const findings = (issue: Issue) =>
  letterFindings(issue).map(({ where, why }) => ({ where, why }));
const why = (issue: Issue) => letterFindings(issue).map((each) => each.why);

describe("an issue's shape", () => {
  const decode = Schema.decodeUnknownExit(Issue);
  const happening = good.happenings?.[0];

  test("takes an issue whose sections are each named data", () => {
    expect(decode(good)._tag).toBe("Success");
    expect(
      decode({
        month: "2027-01",
        title: "A title",
        evenings: [
          {
            name: "allthings/effect",
            text: "A paragraph.",
            source: { _tag: "event", slug: "effect" },
          },
        ],
        openSource: [
          {
            name: "OpenCode",
            text: "A paragraph.",
            source: {
              _tag: "link",
              url: "https://github.com/anomalyco/opencode",
            },
          },
        ],
        papers: [
          {
            name: "A talk",
            text: "A paragraph.",
            source: {
              _tag: "talk",
              id: "6f1c1e5e-2a43-4f8e-9a8f-0d6c1b2a3c4d",
              event: "sync",
            },
          },
        ],
      })._tag,
    ).toBe("Success");
  });

  test.each([
    ["a month that isn't one", { month: "2026-13" }],
    ["a title of two lines", { title: "Two\ntrips" }],
    ["a section with nothing in it", { happenings: [] }],
    [
      "happenings from a link, which no one approved for listing",
      {
        happenings: [
          {
            ...happening,
            source: { _tag: "link", url: "https://example.com/" },
          },
        ],
      },
    ],
    ["an evening that's a guide entry", { evenings: [{ ...happening }] }],
    [
      "an evening at no short link",
      {
        evenings: [
          { ...happening, source: { _tag: "event", slug: "Not A Slug" } },
        ],
      },
    ],
    [
      "a link over http",
      {
        jobs: [
          {
            name: "A role",
            text: "A paragraph.",
            source: { _tag: "link", url: "http://example.com/jobs" },
          },
        ],
      },
    ],
    [
      "an item of two paragraphs",
      { happenings: [{ ...happening, text: "One.\n\nTwo." }] },
    ],
    ["a closing of two paragraphs", { closing: "One.\n\nTwo." }],
  ])("refuses %s", (_, overrides) => {
    expect(decode({ ...good, ...overrides })._tag).toBe("Failure");
  });

  test("its sections read in the letter's order, whatever the file's", () => {
    const { closing: _, ...rest } = good;
    const jumbled = {
      jobs: [
        {
          name: "A role",
          text: "A paragraph.",
          source: { _tag: "link" as const, url: "https://example.com/jobs" },
        },
      ],
      ...rest,
      evenings: [
        {
          name: "allthings/effect",
          text: "A paragraph.",
          source: { _tag: "event" as const, slug: "effect" },
        },
      ],
    };
    expect(itemsOf(jumbled).map(({ key }) => key)).toEqual([
      "evenings",
      "happenings",
      "happenings",
      "jobs",
    ]);
  });
});

describe("the letter's rules", () => {
  test("an issue that keeps them breaks none", () => {
    expect(letterFindings(good)).toEqual([]);
  });

  test("our voice, in every paragraph, name and title", () => {
    expect(findings({ ...good, title: "A seamless December" })).toEqual([
      { where: "title", why: "hype: say what works and how" },
    ]);
    expect(findings({ ...good, closing: "Thanks to our sponsors." })).toEqual([
      {
        where: "closing",
        why: "companies host evenings, they don't sponsor them",
      },
    ]);
  });

  test("a guide entry by its id, under the guide's name for it", () => {
    const [first, second] = good.happenings ?? [];
    if (first === undefined || second === undefined) throw new Error("fixture");
    expect(
      why({
        ...good,
        happenings: [
          { ...first, source: { _tag: "guide", id: "no-such" } },
          second,
        ],
      }),
    ).toEqual(["names a guide entry the guide doesn't have"]);
    expect(
      why({ ...good, happenings: [{ ...first, name: "ReactMiami" }, second] }),
    ).toEqual(["the guide calls it React Miami"]);
  });

  test("a word budget for each section and for the whole letter", () => {
    const [first, second] = good.happenings ?? [];
    if (first === undefined || second === undefined) throw new Error("fixture");
    const over =
      wordBudget.happenings - wordCount(first.name) - wordCount(second.name);
    expect(
      why({
        ...good,
        happenings: [
          { ...first, text: `${words(20)}. ${words(20)}. ${words(20)}.` },
          { ...second, text: `${words(38)}. ${words(over - 60 + 1 - 38)}.` },
        ],
      }),
    ).toEqual([
      `${wordBudget.happenings + 1} words: cut to ${wordBudget.happenings}`,
    ]);
    expect(
      why({ ...good, closing: `${words(27)}. ${words(27)}. ${words(27)}.` }),
    ).toEqual([`81 words: cut to ${wordBudget.closing}`]);
    const long = (n: number) => ({
      name: "A role",
      text: `${words(n)}.`,
      source: { _tag: "link" as const, url: "https://example.com/jobs" },
    });
    const evening = (n: number) => ({
      name: "allthings/effect",
      text: `${words(n)}.`,
      source: { _tag: "event" as const, slug: "effect" },
    });
    const full: Issue = {
      ...good,
      evenings: [evening(36), evening(36), evening(36)],
      openSource: [long(30), long(30), long(30)],
      papers: [long(30), long(30), long(30)],
      jobs: [long(35), long(35)],
    };
    expect(letterWords(full)).toBeGreaterThan(letterBudget);
    expect(why(full)).toEqual([
      `${letterWords(full)} words: cut to ${letterBudget}, a two-minute read`,
    ]);
  });

  test("one question at most", () => {
    expect(
      why({ ...good, closing: "Who is coming? Who is bringing a friend?" }),
    ).toEqual(["2 questions: ask 1 at most"]);
    expect(why({ ...good, closing: "Who is coming?" })).toEqual([]);
    // A name is read too: a question there counts.
    const hiring = {
      name: "Who is hiring?",
      text: "A paragraph.",
      source: { _tag: "link" as const, url: "https://example.com/jobs" },
    };
    expect(why({ ...good, closing: "Who is coming?", jobs: [hiring] })).toEqual(
      ["2 questions: ask 1 at most"],
    );
    // A name is never an opener, though: one opening a section is fine.
    const { happenings: _, ...rest } = good;
    expect(
      why({ ...rest, jobs: [{ ...hiring, name: "This month's roles" }] }),
    ).toEqual([]);
  });

  test("no greeting, and no calendar for an opener", () => {
    const [first, second] = good.happenings ?? [];
    if (first === undefined || second === undefined) throw new Error("fixture");
    const opening = (text: string) =>
      why({ ...good, happenings: [{ ...first, text }, second] });
    expect(opening("Hi all, React Miami is in April.")).toEqual([
      "a greeting: start with the news",
    ]);
    expect(opening("This month, React Miami opened its doors.")).toEqual([
      "the calendar as an opener: start with the particular",
    ]);
    expect(opening("It's December, and React Miami is in April.")).toEqual([
      "the calendar as an opener: start with the particular",
    ]);
    expect(why({ ...good, title: "Happy holidays from us" })).toEqual([
      "a greeting: start with the news",
    ]);
    // The second item isn't an opener: only the first words under the title are.
    expect(
      why({
        ...good,
        happenings: [first, { ...second, text: "This month it sold out." }],
      }),
    ).toEqual([]);
    expect(why({ ...good, closing: "Hope you're well. See you." })).toEqual([
      "a greeting cliché: cut it",
    ]);
    expect(why({ ...good, closing: "Another year has flown by." })).toEqual([
      "a greeting cliché: cut it",
    ]);
  });

  test("every link https, as words, to what the issue names or this site", () => {
    const closing = (text: string) => why({ ...good, closing: text });
    expect(closing("See [the year](http://allthings.dev/year/2026).")).toEqual([
      "a link that isn't https",
    ]);
    expect(closing("See [a page](https://example.com/).")).toEqual([
      "a link to nothing the issue names and no page of this site",
    ]);
    expect(closing("See [a page](https://allthings.dev/admin).")).toEqual([
      "a link to nothing the issue names and no page of this site",
    ]);
    expect(closing("See https://allthings.dev/year/2026 for more.")).toEqual([
      "a bare address: link words instead, [words](url)",
    ]);
    for (const href of [
      "https://allthings.dev",
      "https://allthings.dev/guide#react-miami",
      "https://allthings.dev/letter/2026-11",
      "https://luma.com/allthings",
      "https://www.reactmiami.com/",
    ]) {
      expect({ href, why: closing(`See [it](${href}).`) }).toEqual({
        href,
        why: [],
      });
    }
  });
});

describe("prose", () => {
  test("is read as words and links", () => {
    expect(
      proseParts("See [the guide](https://allthings.dev/guide), then go."),
    ).toEqual([
      { text: "See " },
      { text: "the guide", href: "https://allthings.dev/guide" },
      { text: ", then go." },
    ]);
    expect(plainText("See [the guide](https://allthings.dev/guide).")).toBe(
      "See the guide.",
    );
    expect(
      wordCount("See [the guide](https://allthings.dev/guide) — 2 go."),
    ).toBe(5);
  });

  test("an item's name links to what it names", () => {
    expect(sourceUrl({ _tag: "event", slug: "effect" })).toBe(
      "https://allthings.dev/effect",
    );
    expect(
      sourceUrl({ _tag: "event", slug: "shared/typescript-ai-demo-day" }),
    ).toBe("https://allthings.dev/shared/typescript-ai-demo-day");
    expect(
      sourceUrl({
        _tag: "talk",
        id: "6f1c1e5e-2a43-4f8e-9a8f-0d6c1b2a3c4d",
        event: "sync",
      }),
    ).toBe("https://allthings.dev/sync");
    expect(sourceUrl({ _tag: "guide", id: "react-miami" })).toBe(
      guideEntries.find((entry) => entry.id === "react-miami")?.url ?? "",
    );
  });
});

describe("approval", () => {
  test("covers the words as written and where each name links", async () => {
    const links = itemsOf(good).map(({ item }) => sourceUrl(item.source));
    expect(await Effect.runPromise(issueToken(good))).toBe(
      await Effect.runPromise(approvalToken({ issue: good, links })),
    );
    expect(await Effect.runPromise(issueToken(good))).not.toBe(
      await Effect.runPromise(approvalToken(good)),
    );
  });

  test("publishes an issue only as Erik read it, newest first", async () => {
    const later: Issue = { ...good, month: "2027-01" };
    const token = await Effect.runPromise(issueToken(good));
    const laterToken = await Effect.runPromise(issueToken(later));
    const published = (recorded: Parameters<typeof publishedOf>[1]) =>
      Effect.runPromise(publishedOf([good, later], recorded)).then((letters) =>
        letters.map(({ month, approved }) => ({ month, on: approved.on })),
      );
    expect(await published([])).toEqual([]);
    expect(
      await published([
        { month: "2026-12", on: "2026-12-01", token },
        { month: "2027-01", on: "2027-01-04", token: laterToken },
      ]),
    ).toEqual([
      { month: "2027-01", on: "2027-01-04" },
      { month: "2026-12", on: "2026-12-01" },
    ]);
    // A token for another month's words approves nothing.
    expect(
      await published([{ month: "2027-01", on: "2027-01-04", token }]),
    ).toEqual([]);
    // One word changed after Erik's y makes it a draft again.
    const changed = await Effect.runPromise(
      publishedOf(
        [{ ...good, title: "Two trips for May" }],
        [{ month: "2026-12", on: "2026-12-01", token }],
      ),
    );
    expect(changed).toEqual([]);
  });
});

describe("the corpus of Erik's edits", () => {
  const edit = (overrides: Partial<Edit> = {}): Edit => ({
    month: "2026-12",
    where: "closing",
    kind: "reword",
    before: "See you at the next",
    after: "See you there",
    ...overrides,
  });

  test("counts his edits to an issue by kind", () => {
    expect(
      editsOf("2026-12", [
        edit(),
        edit({ kind: "cut", after: "" }),
        edit({ kind: "cut", after: "" }),
        edit({ month: "2027-01" }),
      ]),
    ).toEqual({ cut: 2, reword: 1, fact: 0 });
  });

  test("finds an issue saying again what he edited out, however it's wrapped", () => {
    expect(repeatsOfEdits(good, [edit()])).toEqual([
      {
        where: "closing",
        why: "Erik changed this in 2026-12",
        said: "See you at the next",
      },
    ]);
    expect(
      repeatsOfEdits({ ...good, closing: "See you at\nthe NEXT one." }, [
        edit({ kind: "cut", after: "", why: "a sign-off says nothing" }),
      ]).map((each) => each.why),
    ).toEqual(["Erik cut this in 2026-12: a sign-off says nothing"]);
    expect(repeatsOfEdits(good, [edit({ before: "Nothing like it" })])).toEqual(
      [],
    );
  });

  test("every after reads in our voice, and is for an issue there is", () => {
    const months = new Set(everyIssue.map((issue) => issue.month));
    for (const each of corpus) {
      expect({ edit: each, findings: voiceFindings(each.after) }).toEqual({
        edit: each,
        findings: [],
      });
      expect({ edit: each, month: months.has(each.month) }).toEqual({
        edit: each,
        month: true,
      });
    }
  });
});

describe("every issue in core/letters/", () => {
  const folder = new URL("../letters/", import.meta.url).pathname;
  const files = [...new Bun.Glob("*.ts").scanSync(folder)]
    .filter((file) => file !== "index.ts")
    .toSorted();

  test("is a file named for its month, and listed", async () => {
    for (const file of files) {
      expect(file).toMatch(/^\d{4}-(?:0[1-9]|1[0-2])\.ts$/);
      const { default: written } = (await import(`${folder}${file}`)) as {
        default: unknown;
      };
      expect({ file, listed: issueFiles.includes(written) }).toEqual({
        file,
        listed: true,
      });
      expect(Schema.decodeUnknownSync(Issue)(written).month).toBe(
        file.replace(/\.ts$/, ""),
      );
    }
    expect(issueFiles).toHaveLength(files.length);
    expect(new Set(everyIssue.map((issue) => issue.month)).size).toBe(
      everyIssue.length,
    );
  });

  test("breaks none of the letter's rules, and says nothing Erik edited out", () => {
    for (const issue of everyIssue) {
      expect({
        month: issue.month,
        findings: [...letterFindings(issue), ...repeatsOfEdits(issue)],
      }).toEqual({ month: issue.month, findings: [] });
    }
  });

  test("approved is approved as written: each approval names an issue's words now", async () => {
    for (const approval of approvals) {
      const issue = everyIssue.find((each) => each.month === approval.month);
      const token =
        issue === undefined ? null : await Effect.runPromise(issueToken(issue));
      // A mismatch means the issue changed after Erik's y: read it to him
      // again (bun run letter show), or put back what he approved.
      expect({ month: approval.month, token }).toEqual({
        month: approval.month,
        token: approval.token,
      });
    }
    expect(new Set(approvals.map((each) => each.month)).size).toBe(
      approvals.length,
    );
    const published = await Effect.runPromise(publishedLetters);
    expect(published.map((letter) => letter.month).toSorted()).toEqual(
      approvals.map((each) => each.month).toSorted(),
    );
  });
});

const db = await seededDatabase();
afterAll(() => db.close());
await db.exec(`
  INSERT INTO event_slugs (slug, event_id) VALUES
    ('acme', 'e0000000-0000-4000-8000-000000000001'),
    ('draft', 'e0000000-0000-4000-8000-000000000002'),
    ('soon', 'e0000000-0000-4000-8000-000000000004');
  UPDATE events SET short_slug = 'acme' WHERE id = 'e0000000-0000-4000-8000-000000000001';
  UPDATE events SET short_slug = 'draft' WHERE id = 'e0000000-0000-4000-8000-000000000002';
  UPDATE events SET short_slug = 'soon' WHERE id = 'e0000000-0000-4000-8000-000000000004';
`);

describe("an issue's evenings and talks, against the database", () => {
  const check = (issue: Issue) =>
    Effect.runPromise(
      sourceFindings(issue).pipe(
        Effect.provide(Layer.merge(sqlLayer(db), clockLayer)),
      ),
    ).then((found) =>
      found.map((each) => ({ why: each.why, said: each.said })),
    );
  const evening = (slug: string) => ({
    name: "An evening",
    text: "A paragraph.",
    source: { _tag: "event" as const, slug },
  });
  const talk = (id: string, event: string) => ({
    name: "A talk",
    text: "A paragraph.",
    source: {
      _tag: "talk" as const,
      id: `a0000000-0000-4000-8000-${id}`,
      event,
    },
  });

  test("takes a published evening of ours ahead, and a talk given at its evening", async () => {
    expect(
      await check({
        ...good,
        evenings: [evening("soon")],
        papers: [talk("000000000001", "acme")],
      }),
    ).toEqual([]);
  });

  test("refuses a draft, a link no evening has, one over, and a talk from elsewhere", async () => {
    expect(
      await check({
        ...good,
        evenings: [evening("draft"), evening("nowhere"), evening("acme")],
        papers: [talk("000000000005", "acme")],
      }),
    ).toEqual([
      {
        why: "names an evening no published evening has as its short link",
        said: "draft",
      },
      {
        why: "names an evening no published evening has as its short link",
        said: "nowhere",
      },
      {
        why: "our next evenings: an evening of ours, not yet over",
        said: "acme",
      },
      {
        why: "names a talk not given at the evening it names",
        said: "a0000000-0000-4000-8000-000000000005",
      },
    ]);
  });
});
