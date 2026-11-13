import { Effect, Schema } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import approvalsFile from "../letters/approvals.json" with { type: "json" };
import corpusFile from "../letters/before-after.json" with { type: "json" };
import { issueFiles } from "../letters/index.ts";
import { approvalToken, isApprovalToken } from "./approval.ts";
import { ahead, ours, published } from "./catalog.ts";
import { asOf } from "./clock.ts";
import { HttpUrl } from "./contract.ts";
import { guideEntries } from "./guide.ts";
import { isShortSlug } from "./short-slugs.ts";
import { voiceFindings } from "./voice.ts";

/**
 * The allthings letter: one a month, written by Claude and sent only once
 * Erik has read it and said y. Each issue is a file in core/letters/
 * (2026-12.ts), its sections in a fixed order, each item naming the data
 * it is about: an evening by its short link, a guide entry by its id, a
 * talk by its id and its evening's link. A section with nothing real in it
 * is left out, never padded.
 *
 * Every word is held to our voice (src/voice.ts) and to the letter's own
 * rules below, as `letterFindings`: a word budget per section and for the
 * whole letter, one question at most, no greeting and no "this month"
 * opener, and every link https and to something the issue names or a page
 * of this site. tests/letter.test.ts holds every issue to them.
 *
 * An issue is published (on its page, in the API and the MCP server, in
 * the sitemap) only once approved: core/letters/approvals.json records
 * Erik's y with the approval token of exactly what he read (src/approval.ts).
 * Change one word and the token no longer matches, so the issue is a draft
 * again until he reads it again. `bun run letter approve <yyyy-mm> <token>`
 * is the one way an approval is written.
 *
 * Erik's edits to a draft become rules here where they generalize, and
 * examples in core/letters/before-after.json where they don't (`Edit`).
 */

/** An issue's month, YYYY-MM. */
export const Month = Schema.String.check(
  Schema.isPattern(/^\d{4}-(?:0[1-9]|1[0-2])$/, {
    message: "must be a month, YYYY-MM",
  }),
);

/** Words on one line, without leading or trailing space. */
const Line = Schema.String.check(
  Schema.isPattern(/^\S(?:.*\S)?$/, {
    message:
      "must say something on one line, without leading or trailing space",
  }),
);

/** One paragraph: words, wrapped across lines if need be, never a blank line. */
const Paragraph = Schema.String.check(
  Schema.makeFilter((value: string) =>
    value.trim() === ""
      ? "must say something"
      : /\n[ \t]*\n/.test(value)
        ? "must be one paragraph, with no blank line"
        : undefined,
  ),
);

/** An evening's short link (src/short-slugs.ts): effect, or shared/<name>. */
const ShortSlug = Schema.String.check(
  Schema.makeFilter((value: string) =>
    isShortSlug(value) ? undefined : `${value} is not a short link`,
  ),
);

/** An https URL: the letter links nothing over plain http. */
const HttpsUrl = HttpUrl.check(
  Schema.isPattern(/^https:\/\//, { message: "must be an https URL" }),
);

/** One of our evenings, or one we share, by its short link. */
export const EventSource = Schema.TaggedStruct("event", { slug: ShortSlug });
/** An entry in the allthings guide (src/guide.ts), by its id. */
export const GuideSource = Schema.TaggedStruct("guide", {
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
});
/** A talk given at one of our evenings, by its id and its evening's short link. */
export const TalkSource = Schema.TaggedStruct("talk", {
  id: Schema.String.check(
    Schema.isPattern(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    ),
  ),
  event: ShortSlug,
});
/** A page elsewhere, for what this site keeps no data on yet: a repository, a paper, a role. */
export const LinkSource = Schema.TaggedStruct("link", { url: HttpsUrl });

export const Source = Schema.Union([
  EventSource,
  GuideSource,
  TalkSource,
  LinkSource,
]);
export type Source = typeof Source.Type;

/** One thing a section tells about: its name, a paragraph, and what it is. */
const item = <S extends Schema.Top>(source: S) =>
  Schema.Struct({
    /** As its makers write it; for a guide entry, as the guide does. */
    name: Line,
    /**
     * A paragraph on it, in our voice. Links are written `[words](url)`,
     * never bare.
     */
    text: Paragraph,
    source,
  });

/** A section: its items, at least one. A section with none is left out of the issue. */
const section = <S extends Schema.Top>(source: S) =>
  Schema.optionalKey(Schema.Array(item(source)).check(Schema.isMinLength(1)));

/**
 * An issue as written in core/letters/<yyyy-mm>.ts. Its sections are keys,
 * so their order is the letter's and never the file's (`sectionOrder`);
 * which data each may name is its schema: happenings only what the guide
 * lists or an evening the site publishes, so nothing reaches the letter
 * that Erik hasn't already put out.
 */
export const Issue = Schema.Struct({
  month: Month,
  /** The issue's title: its page's heading and its email's subject. */
  title: Line,
  /** The next evenings of ours. */
  evenings: section(EventSource),
  /** Happenings worth your time: the guide's entries and the evenings we share. */
  happenings: section(Schema.Union([GuideSource, EventSource])),
  /** Open source new to the community. */
  openSource: section(Schema.Union([LinkSource, TalkSource])),
  /** The month's paper picks. */
  papers: section(Schema.Union([LinkSource, TalkSource])),
  /** Roles at companies Erik vouches for. */
  jobs: section(LinkSource),
  /** A closing paragraph: the one place for wit. */
  closing: Schema.optionalKey(Paragraph),
});
export type Issue = typeof Issue.Type;

/** A section's key in an issue. */
export type SectionKey =
  | "evenings"
  | "happenings"
  | "openSource"
  | "papers"
  | "jobs";

/** The sections in the order every issue is read in, the closing after them. */
export const sectionOrder: ReadonlyArray<SectionKey> = [
  "evenings",
  "happenings",
  "openSource",
  "papers",
  "jobs",
];

/** Each section's heading. */
export const sectionTitles: Readonly<Record<SectionKey, string>> = {
  evenings: "our next evenings",
  happenings: "worth your time",
  openSource: "new open source",
  papers: "papers",
  jobs: "jobs",
};

/**
 * The most words each part may take, its items' names and paragraphs
 * counted. The closing's is a paragraph's worth.
 */
export const wordBudget: Readonly<Record<SectionKey | "closing", number>> = {
  evenings: 120,
  happenings: 140,
  openSource: 100,
  papers: 100,
  jobs: 80,
  closing: 80,
};

/**
 * The most words a whole issue may take, its title counted: a two-minute
 * read at 200 words a minute, the pace of someone reading on a phone.
 */
export const letterBudget = 400;

/** The most question marks in an issue: a question is a device, and devices wear out. */
export const mostQuestions = 1;

/**
 * Pages of this site an issue may link besides what it names: canonical
 * and absolute, as an email's links must be.
 */
export const siteOrigin = "https://allthings.dev";
const sitePages: ReadonlyArray<RegExp> = [
  /^\/?$/,
  /^\/events$/,
  /^\/talks$/,
  /^\/guide(?:#[a-z0-9-]+)?$/,
  /^\/people$/,
  /^\/about$/,
  /^\/coach$/,
  /^\/year\/\d{4}$/,
  /^\/letter(?:\/\d{4}-\d{2})?$/,
];

/** The community calendar on Luma, where people subscribe to every evening. */
export const lumaCalendar = "https://luma.com/allthings";

/** Where an item's name links: the data it is about. */
export function sourceUrl(source: Source): string {
  if (source._tag === "event") return `${siteOrigin}/${source.slug}`;
  if (source._tag === "talk") return `${siteOrigin}/${source.event}`;
  if (source._tag === "link") return source.url;
  return (
    guideEntries.find((entry) => entry.id === source.id)?.url ??
    `${siteOrigin}/guide`
  );
}

/** An issue's items, section by section in the letter's order. */
export function itemsOf(issue: Issue) {
  return sectionOrder.flatMap((key) =>
    (issue[key] ?? []).map((each) => ({ key, item: each })),
  );
}

/** The links an issue may make: what it names, their own sources, and this site's pages. */
function knownLink(issue: Issue, url: string): boolean {
  const named = itemsOf(issue).flatMap(({ item: { source } }) => [
    sourceUrl(source),
    ...(source._tag === "guide"
      ? (guideEntries.find((entry) => entry.id === source.id)?.sources ?? [])
      : []),
  ]);
  if (named.includes(url) || url === lumaCalendar) return true;
  if (!url.startsWith(siteOrigin)) return false;
  const rest = url.slice(siteOrigin.length);
  return sitePages.some((page) => page.test(rest));
}

/** A piece of prose: words, or words linking somewhere. */
export type Part =
  | { readonly text: string }
  | { readonly text: string; readonly href: string };

const markdownLink = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/** `text`'s words and links, in order, for a page or an email to render. */
export function proseParts(text: string): ReadonlyArray<Part> {
  const parts: Part[] = [];
  let at = 0;
  for (const match of text.matchAll(markdownLink)) {
    if (match.index > at) parts.push({ text: text.slice(at, match.index) });
    parts.push({ text: match[1] ?? "", href: match[2] ?? "" });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** `text` as it reads: its links' words, without their addresses. */
export const plainText = (text: string): string =>
  proseParts(text)
    .map((part) => part.text)
    .join("");

/** The words in `text`, as a reader counts them. */
export const wordCount = (text: string): number =>
  plainText(text)
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

/** Openings a letter never starts with: a greeting, or the calendar instead of the news. */
const openers: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /^(?:hi|hello|hey|dear|greetings|welcome|happy|season['’]s|hope|howdy|good (?:morning|afternoon|evening))\b/i,
    "a greeting: start with the news",
  ],
  [
    /^(?:this|last|next) (?:month|week|year|season)\b|^as (?:the )?(?:year|month)\b|^it['’]?s (?:december|january|february|march|april|may|june|july|august|september|october|november)\b/i,
    "the calendar as an opener: start with the particular",
  ],
];

/** Greeting clichés, wherever they turn up. */
const greetings: ReadonlyArray<RegExp> = [
  /\bhope (?:this|you['’]?re|you are|you['’]?ve|all is)\b/i,
  /\bfinds you well\b/i,
  /\bwithout further ado\b/i,
  /\b(?:another|one more) (?:month|year) (?:has )?(?:gone|flown|passed)\b/i,
  /\btime flies\b/i,
  /\bit['’]?s that time of (?:the )?year\b/i,
  /\bwhere did the (?:month|year) go\b/i,
  /\bwelcome to (?:the|our|this) (?:letter|newsletter|issue|first)\b/i,
];

/** A rule an issue broke: where, why, and the words that broke it. */
export interface LetterFinding {
  readonly where: string;
  readonly why: string;
  readonly said: string;
}

/** Each rule `issue` breaks; empty when it may go to Erik for his y. */
export function letterFindings(issue: Issue): ReadonlyArray<LetterFinding> {
  const findings: LetterFinding[] = [];
  const prose: Array<{ readonly where: string; readonly text: string }> = [
    { where: "title", text: issue.title },
    ...itemsOf(issue).flatMap(({ key, item: each }) => [
      { where: `${key}: ${each.name}`, text: each.text },
    ]),
    ...(issue.closing === undefined
      ? []
      : [{ where: "closing", text: issue.closing }]),
  ];

  // Every word a reader reads: the prose and the items' names. A name is
  // never an opener, so the opening rules read `prose` alone.
  const everything = [
    ...prose,
    ...itemsOf(issue).map(({ key, item: each }) => ({
      where: `${key}: ${each.name}`,
      text: each.name,
    })),
  ];

  // Our voice, word for word.
  for (const { where, text } of everything) {
    for (const { why, said } of voiceFindings(plainText(text))) {
      findings.push({ where, why, said });
    }
  }

  // What each item names is data the site has.
  for (const { key, item: each } of itemsOf(issue)) {
    const { source } = each;
    if (source._tag !== "guide") continue;
    const entry = guideEntries.find((one) => one.id === source.id);
    if (entry === undefined) {
      findings.push({
        where: `${key}: ${each.name}`,
        why: "names a guide entry the guide doesn't have",
        said: source.id,
      });
    } else if (entry.name !== each.name) {
      findings.push({
        where: `${key}: ${each.name}`,
        why: `the guide calls it ${entry.name}`,
        said: each.name,
      });
    }
  }

  // The word budgets.
  for (const key of sectionOrder) {
    const items = issue[key];
    if (items === undefined) continue;
    const words = items.reduce(
      (sum, each) => sum + wordCount(each.name) + wordCount(each.text),
      0,
    );
    if (words > wordBudget[key]) {
      findings.push({
        where: key,
        why: `${words} words: cut to ${wordBudget[key]}`,
        said: items.map((each) => each.name).join(", "),
      });
    }
  }
  if (issue.closing !== undefined) {
    const words = wordCount(issue.closing);
    if (words > wordBudget.closing) {
      findings.push({
        where: "closing",
        why: `${words} words: cut to ${wordBudget.closing}`,
        said: `${issue.closing.slice(0, 60)}…`,
      });
    }
  }
  const total = letterWords(issue);
  if (total > letterBudget) {
    findings.push({
      where: "the letter",
      why: `${total} words: cut to ${letterBudget}, a two-minute read`,
      said: issue.title,
    });
  }

  // One question at most.
  const questions = everything.flatMap(({ where, text }) =>
    [...plainText(text).matchAll(/\?/g)].map(() => where),
  );
  if (questions.length > mostQuestions) {
    findings.push({
      where: questions.join(", "),
      why: `${questions.length} questions: ask ${mostQuestions} at most`,
      said: "?",
    });
  }

  // No greeting, and the news first: in the title, and in the first words under it.
  const opening = [
    prose[0],
    prose.find(({ where }) => where !== "title"),
  ].filter((each) => each !== undefined);
  for (const { where, text } of opening) {
    for (const [pattern, why] of openers) {
      const found = pattern.exec(plainText(text).trim());
      if (found) findings.push({ where, why, said: found[0] });
    }
  }
  for (const { where, text } of prose) {
    for (const pattern of greetings) {
      const found = pattern.exec(plainText(text).replace(/\s+/g, " "));
      if (found) {
        findings.push({
          where,
          why: "a greeting cliché: cut it",
          said: found[0],
        });
      }
    }
  }

  // Links: https, written as words, and to what the issue names or this site.
  for (const { where, text } of everything) {
    for (const part of proseParts(text)) {
      if ("href" in part) {
        if (!part.href.startsWith("https://")) {
          findings.push({
            where,
            why: "a link that isn't https",
            said: part.href,
          });
        } else if (!knownLink(issue, part.href)) {
          findings.push({
            where,
            why: "a link to nothing the issue names and no page of this site",
            said: part.href,
          });
        }
      } else {
        const bare = /\b(?:https?:\/\/|www\.)\S+/i.exec(part.text);
        if (bare) {
          findings.push({
            where,
            why: "a bare address: link words instead, [words](url)",
            said: bare[0],
          });
        }
      }
    }
  }

  return findings;
}

/**
 * Each item of `issue` naming an evening or a talk the site doesn't
 * publish as named: an evening no published evening has as its short link;
 * in our next evenings, one that isn't ours or is already over; a talk not
 * given at the evening it names. It reads the database, so it isn't in
 * `letterFindings`: `bun run letter approve` runs it, and refuses an issue
 * with any, before Erik is asked for his y.
 */
export const sourceFindings = (issue: Issue) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const now = yield* asOf;
    const findings: LetterFinding[] = [];
    for (const { key, item: each } of itemsOf(issue)) {
      const { source } = each;
      if (source._tag !== "event" && source._tag !== "talk") continue;
      const where = `${key}: ${each.name}`;
      const slug = source._tag === "event" ? source.slug : source.event;
      const [evening] = yield* sql<{
        readonly id: string;
        readonly ours: boolean;
        readonly ahead: boolean;
      }>`
        SELECT e.id, ${ours(sql, "e")} AS ours, ${ahead(sql, "e", now)} AS ahead
        FROM events e
        WHERE ${published(sql, "e")} AND e.short_slug = ${slug}`;
      if (evening === undefined) {
        findings.push({
          where,
          why: "names an evening no published evening has as its short link",
          said: slug,
        });
        continue;
      }
      if (key === "evenings" && !(evening.ours && evening.ahead)) {
        findings.push({
          where,
          why: "our next evenings: an evening of ours, not yet over",
          said: slug,
        });
      }
      if (source._tag === "talk") {
        const given = yield* sql`
          SELECT 1 FROM event_talks et
          WHERE et.event_id = ${evening.id} AND et.talk_id = ${source.id}`;
        if (given.length === 0) {
          findings.push({
            where,
            why: "names a talk not given at the evening it names",
            said: source.id,
          });
        }
      }
    }
    return findings;
  });

/** The words a reader reads in `issue`: its title, names, paragraphs and closing. */
export function letterWords(issue: Issue): number {
  return (
    wordCount(issue.title) +
    itemsOf(issue).reduce(
      (sum, { item: each }) =>
        sum + wordCount(each.name) + wordCount(each.text),
      0,
    ) +
    (issue.closing === undefined ? 0 : wordCount(issue.closing))
  );
}

/** Every issue as written, drafts included, oldest first. Never served: see `publishedLetters`. */
export const everyIssue: ReadonlyArray<Issue> = issueFiles
  .map((file) => Schema.decodeUnknownSync(Issue)(file))
  .toSorted((a, b) => a.month.localeCompare(b.month));

/** Erik's y on an issue: the day he gave it, and the approval token of what he read. */
export const Approval = Schema.Struct({
  month: Month,
  /** The day, YYYY-MM-DD in San Francisco. */
  on: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/)),
  token: Schema.String.check(
    Schema.makeFilter((value: string) =>
      isApprovalToken(value) ? undefined : "must be an approval token",
    ),
  ),
});
export type Approval = typeof Approval.Type;

export const ApprovalsFile = Schema.Struct({
  approvals: Schema.Array(Approval),
});

/** Every approval recorded, as written. */
export const approvals: ReadonlyArray<Approval> =
  Schema.decodeUnknownSync(ApprovalsFile)(approvalsFile).approvals;

/**
 * The approval token of `issue` as Erik reads it: its words exactly as
 * written, and where each item's name links. A guide entry's site is read
 * from the guide, so a new address there changes the token too, and the
 * issue is a draft until he reads it again.
 */
export const issueToken = (issue: Issue) =>
  approvalToken({
    issue,
    links: itemsOf(issue).map(({ item: each }) => sourceUrl(each.source)),
  });

/** An issue Erik approved, as it is published. */
export interface Letter extends Issue {
  readonly approved: Approval;
}

/**
 * The issues of `issues` approved in `recorded`, each exactly as Erik read
 * it, newest first: the only ones any page, feed, API or tool shows. An
 * issue changed after its approval is left out until he approves it again.
 */
export const publishedOf = (
  issues: ReadonlyArray<Issue>,
  recorded: ReadonlyArray<Approval>,
): Effect.Effect<ReadonlyArray<Letter>> =>
  Effect.forEach(issues, (issue) =>
    Effect.map(issueToken(issue), (token): ReadonlyArray<Letter> => {
      const approved = recorded.find(
        (each) => each.month === issue.month && each.token === token,
      );
      return approved === undefined ? [] : [{ ...issue, approved }];
    }),
  ).pipe(
    Effect.map((letters) =>
      letters.flat().toSorted((a, b) => b.month.localeCompare(a.month)),
    ),
  );

/** The letters published now: every issue, as approvals.json approves it. */
export const publishedLetters: Effect.Effect<ReadonlyArray<Letter>> =
  publishedOf(everyIssue, approvals);

/** The kind of edit Erik made to a draft. */
export const EditKind = Schema.Literals(["cut", "reword", "fact"]);

/**
 * One of Erik's edits to a draft, kept as an example (core/letters/before-after.json):
 * the issue's month, which part, what the draft said and what he made it
 * (empty when he cut it), and why, when he said. Every `after` passes our
 * voice, and no issue says a `before` again.
 */
export const Edit = Schema.Struct({
  month: Month,
  where: Line,
  kind: EditKind,
  before: Schema.String.check(Schema.isMinLength(1)),
  after: Schema.String,
  why: Schema.optionalKey(Line),
});
export type Edit = typeof Edit.Type;

export const CorpusFile = Schema.Struct({
  about: Schema.String,
  edits: Schema.Array(Edit),
});

/** Erik's edits, as examples, in the order he made them. */
export const corpus: ReadonlyArray<Edit> =
  Schema.decodeUnknownSync(CorpusFile)(corpusFile).edits;

/** Erik's edits to the issue of `month`, by kind: the measure is fewer cuts over time. */
export function editsOf(
  month: string,
  edits: ReadonlyArray<Edit> = corpus,
): Readonly<Record<typeof EditKind.Type, number>> {
  const of = edits.filter((edit) => edit.month === month);
  return {
    cut: of.filter((edit) => edit.kind === "cut").length,
    reword: of.filter((edit) => edit.kind === "reword").length,
    fact: of.filter((edit) => edit.kind === "fact").length,
  };
}

/** Each place `issue` says again what Erik once edited out of a draft. */
export function repeatsOfEdits(
  issue: Issue,
  edits: ReadonlyArray<Edit> = corpus,
): ReadonlyArray<LetterFinding> {
  const prose = [
    { where: "title", text: issue.title },
    ...itemsOf(issue).map(({ key, item: each }) => ({
      where: `${key}: ${each.name}`,
      text: each.text,
    })),
    ...(issue.closing === undefined
      ? []
      : [{ where: "closing", text: issue.closing }]),
  ];
  const squeeze = (text: string) =>
    plainText(text).replace(/\s+/g, " ").trim().toLowerCase();
  return prose.flatMap(({ where, text }) =>
    edits
      .filter((edit) => squeeze(text).includes(squeeze(edit.before)))
      .map((edit) => ({
        where,
        why: `Erik ${edit.kind === "cut" ? "cut" : "changed"} this in ${edit.month}${edit.why === undefined ? "" : `: ${edit.why}`}`,
        said: edit.before,
      })),
  );
}
