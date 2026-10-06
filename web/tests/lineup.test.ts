import { describe, expect, test } from "bun:test";
import type {
  EventPage,
  Speaker,
  Talk,
} from "allthings-core/src/event-page.ts";
import type { SafeHtml } from "allthings-core/src/rich-text.ts";
import { DateTime } from "effect";
import { eventPage } from "../src/pages/event.tsx";
import {
  cardsUpTo,
  lineupDensity,
  rowsUpTo,
  talkPeople,
} from "../src/pages/lineup.ts";
import { htmlProblems } from "./support/pages.ts";

/** How dense an evening's lineup is, by its number of talks (lineup.ts). */

const at = (iso: string) => DateTime.makeUnsafe(iso);

const speaker = (n: number, overrides: Partial<Speaker> = {}): Speaker => ({
  id: `s${n}`,
  slug: `speaker-${n}`,
  name: `Speaker ${n}`,
  title: `Engineer ${n}`,
  bio: `Bio of speaker ${n}.`,
  links: { x: null, bluesky: null, linkedin: null },
  portrait: null,
  role: "speaker",
  ...overrides,
});

const talk = (n: number, overrides: Partial<Talk> = {}): Talk => ({
  id: `t${n}`,
  title: `Talk ${n}`,
  format: "talk",
  startsAt: null,
  description: `<p>About talk ${n}.</p>` as SafeHtml,
  speakers: [speaker(n)],
  ...overrides,
});

const talks = (count: number) =>
  Array.from({ length: count }, (_, index) => talk(index + 1));

/** Seven people on a panel, one of them moderating. */
const panel = talk(99, {
  title: "The panel",
  format: "panel",
  speakers: Array.from({ length: 7 }, (_, index) =>
    speaker(
      100 + index,
      index === 6 ? { role: "moderator" } : { role: "panelist" },
    ),
  ),
});

const render = (lineup: ReadonlyArray<Talk>) =>
  eventPage({
    event: {
      id: "e0000000-0000-4000-8000-000000000001",
      slug: "2026-09-30-all-things-effect",
      name: "Effect San Francisco",
      topic: "effect",
      tagline: "All Things Effect",
      about: null,
      status: "past",
      mode: "night",
      startsAt: at("2026-10-01T00:30:00Z"),
      endsAt: at("2026-10-01T03:30:00Z"),
      updatedAt: at("2026-09-01T12:00:00Z"),
      venue: {
        neighborhood: "East Cut",
        name: null,
        address: "201 Spear St, San Francisco, CA 94105, USA",
        mapQuery: "201 Spear St, San Francisco, CA 94105, USA",
      },
      hosts: ["CodeRabbit"],
      hostSites: {},
      organizers: [],
      coHosts: [],
      mcs: [],
      guests: null,
      rsvpUrl: null,
      seats: null,
      program: "talks",
      curation: { kind: "ours" },
      recordingUrl: null,
      talks: lineup,
      schedule: [],
      notes: [],
      photos: [],
      posts: [],
      morePosts: 0,
      next: undefined,
    } satisfies EventPage,
    origin: "https://allthings.dev",
    theme: undefined,
    portraits: new Map(),
    images: "originals",
    now: at("2026-10-05T00:00:00Z"),
  });

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the lineup's density", () => {
  test("is cards up to three talks, rows up to six, then a compact list", () => {
    expect([1, 2, 3, 4, 6, 7, 14].map(lineupDensity)).toEqual([
      "cards",
      "cards",
      "cards",
      "rows",
      "rows",
      "list",
      "list",
    ]);
    expect([cardsUpTo, rowsUpTo]).toEqual([3, 6]);
  });

  test("shows a panel, a fireside chat or a crowded talk as rows, even among few talks", () => {
    expect(talkPeople(talk(1), "cards")).toBe("cards");
    expect(talkPeople(panel, "cards")).toBe("rows");
    expect(talkPeople(talk(1, { format: "fireside" }), "cards")).toBe("rows");
    expect(
      talkPeople(
        talk(1, { speakers: [1, 2, 3, 4].map((n) => speaker(n)) }),
        "cards",
      ),
    ).toBe("rows");
    expect(talkPeople(talk(1), "rows")).toBe("rows");
  });
});

describe("your hosts", () => {
  test("show every host's portrait, named, side by side", () => {
    const html = render(talks(1));
    expect(html).toContain(
      '<span class="host-portraits"><img src="/assets/avatar.',
    );
    const hosts =
      /<span class="host-portraits">(.*?)<\/span>/.exec(html)?.[1] ?? "";
    expect([...hosts.matchAll(/alt="([^"]*)"/g)].map(([, alt]) => alt)).toEqual(
      ["Erik", "Andre"],
    );
    const footer =
      /<span class="portraits">(.*?)<\/span>/.exec(html)?.[1] ?? "";
    expect(
      [...footer.matchAll(/alt="([^"]*)"/g)].map(([, alt]) => alt),
    ).toEqual(["Erik", "Andre"]);
  });
});

describe("an evening with", () => {
  test("one talk shows its speaker in full", async () => {
    const html = render(talks(1));
    expect(count(html, '<article class="speaker">')).toBe(1);
    expect(html).toContain('<p class="speaker-bio">Bio of speaker 1.</p>');
    expect(html).not.toContain('class="stage-people"');
    expect(html).not.toContain('class="lineup"');
    expect(await htmlProblems(html)).toEqual([]);
  });

  test("three talks shows every speaker in full", async () => {
    const html = render(talks(3));
    expect(count(html, '<article class="speaker">')).toBe(3);
    expect(count(html, '<p class="speaker-bio">')).toBe(3);
    expect(await htmlProblems(html)).toEqual([]);
  });

  test("two talks and a seven-person panel shows the panel as rows, its moderator named", async () => {
    const html = render([talk(1), panel, talk(2)]);
    expect(count(html, '<article class="speaker">')).toBe(2);
    expect(count(html, '<ul class="stage-people">')).toBe(1);
    expect(count(html, '<li class="event-person">')).toBe(7);
    expect(html).toContain(
      '<p><span class="speaker-role at-type-meta">moderator</span><a class="event-person-name" href="/people/speaker-106"><span>Speaker 106</span></a><span class="event-person-title">Engineer 106</span></p>',
    );
    // Panelists go unlabeled, and bios are on /people, not in rows.
    expect(html).not.toContain(">panelist<");
    expect(html).not.toContain("Bio of speaker 100.");
    expect(await htmlProblems(html)).toEqual([]);
  });

  test("six talks shows each talk's people as rows, with its description", async () => {
    const html = render(talks(6));
    expect(html).not.toContain('<article class="speaker">');
    expect(count(html, '<ul class="stage-people">')).toBe(6);
    expect(count(html, '<div class="stage-description">')).toBe(6);
    expect(html).not.toContain('class="lineup-about"');
    expect(html).not.toContain("Bio of speaker");
    expect(await htmlProblems(html)).toEqual([]);
  });

  test("fourteen talks shows a compact list, each description behind a disclosure", async () => {
    const lineup = [
      ...talks(13),
      talk(14, {
        format: "fireside",
        speakers: [
          speaker(14),
          speaker(15, { role: "moderator", title: null }),
        ],
      }),
    ];
    const html = render(lineup);
    expect(count(html, '<ol class="lineup">')).toBe(1);
    expect(count(html, '<li class="lineup-talk">')).toBe(14);
    expect(count(html, '<details class="lineup-about">')).toBe(14);
    expect(html).toContain(
      '<details class="lineup-about"><summary class="at-type-meta">about the talk</summary><div class="stage-description"><p>About talk 1.</p></div></details>',
    );
    expect(html).toContain(
      '<h2 class="lineup-title at-type-list-name">Talk 1</h2><ul class="lineup-speakers"><li><a href="/people/speaker-1">Speaker 1</a><span class="lineup-speaker-title">, Engineer 1</span></li></ul>',
    );
    expect(html).toContain(
      '<li><span class="speaker-role at-type-meta">moderator</span> <a href="/people/speaker-15">Speaker 15</a></li>',
    );
    expect(html).toContain('<p class="at-type-meta">fireside chat</p>');
    expect(html).not.toContain('<article class="speaker">');
    expect(html).not.toContain("Bio of speaker");
    expect(await htmlProblems(html)).toEqual([]);
  });
});
