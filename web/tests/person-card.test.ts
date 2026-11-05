import { describe, expect, test } from "bun:test";
import { resolveColor, roleColor, tokens } from "allthings-brand/src/tokens.ts";
import type { PersonPage } from "allthings-core/src/people-directory.ts";
import { DateTime } from "effect";
import type { OgMetrics } from "../scripts/build.ts";
import metrics from "../dist/og-metrics.json" with { type: "json" };
import { built } from "../src/assets.ts";
import { cardHeight, textWidth } from "../src/og/event-card.ts";
import {
  firstName,
  layoutPersonCard,
  personCard,
  personCardFacts,
  personCardGround,
  personCardVersion,
  personPart,
  xHandle,
} from "../src/og/person-card.ts";

/** People's cards' facts and layout, as pure functions of fixed data. */

const measured: OgMetrics = metrics;

const evening = {
  slug: "effect",
  curation: "ours",
  name: "Effect San Francisco",
  topic: "effect",
  status: "past",
  startsAt: DateTime.makeUnsafe("2026-10-01T00:30:00Z"),
} as const;

const person = (overrides: Partial<PersonPage> = {}): PersonPage => ({
  id: "b0000000-0000-4000-8000-000000000001",
  slug: "erik-thorelli",
  name: "Erik Thorelli",
  title: "Head of Developer Experience, CodeRabbit",
  bio: "Erik organizes the evenings.",
  links: {
    x: "https://twitter.com/esthor",
    bluesky: null,
    linkedin: null,
  },
  photo: {
    url: "https://media.allthings.dev/profiles/erik.jpg",
    alt: "Erik Thorelli",
    width: 800,
    height: 800,
    version: "1760000000",
  },
  parts: [],
  organizes: true,
  hosted: [],
  now: null,
  ...overrides,
});

const layout = (overrides: Partial<PersonPage> = {}) =>
  layoutPersonCard(personCardFacts(person(overrides)), measured);

/** The right edge of the words' column: half a margin short of the photo. */
const column = built.og.personPhoto.left - 36;

describe("a person's card", () => {
  test("calls them by their first name when it reads cleanly, else by their name", () => {
    expect(firstName("Erik Thorelli")).toBe("Erik");
    expect(firstName("  Kit   Langton ")).toBe("Kit");
    expect(firstName("JJ Kasper")).toBe("JJ");
    expect(firstName("Jean-Baptiste Kempf")).toBe("Jean-Baptiste");
    expect(firstName("Sébastien Morel")).toBe("Sébastien");
    expect(firstName("James Q Quick")).toBe("James");
    // One name, an initial, a title or a lowercase name: as written.
    expect(firstName("Madonna")).toBe("Madonna");
    expect(firstName("J. Smith")).toBe("J. Smith");
    expect(firstName("Dr. Grace  Hopper")).toBe("Dr. Grace Hopper");
    expect(firstName("danah boyd")).toBe("danah boyd");
  });

  test("reads their X handle from their X link, and only a handle X allows", () => {
    expect(xHandle("https://twitter.com/esthor")).toBe("esthor");
    expect(xHandle("https://twitter.com/@ada")).toBe("ada");
    expect(xHandle("https://x.com/_pilliin_/")).toBe("_pilliin_");
    expect(xHandle("https://www.twitter.com/andrelandgraf")).toBe(
      "andrelandgraf",
    );
    expect(xHandle(null)).toBeNull();
    expect(xHandle("https://bsky.app/profile/ada")).toBeNull();
    expect(xHandle("https://twitter.com/")).toBeNull();
    expect(xHandle("https://twitter.com/a%20b")).toBeNull();
    expect(xHandle("https://twitter.com/sixteen_letters_")).toBeNull();
  });

  test("names their part as the people page groups them", () => {
    const talk = {
      kind: "talk",
      title: "Effect in production",
      role: "panelist",
      evening,
    } as const;
    const role = (name: "co-host" | "mc") =>
      ({ kind: "role", role: name, evening }) as const;
    expect(personPart(person({ parts: [talk] }))).toBe("organizer");
    const member = { organizes: false };
    expect(personPart(person({ ...member, parts: [role("mc"), talk] }))).toBe(
      "speaker",
    );
    expect(
      personPart(person({ ...member, parts: [role("mc"), role("co-host")] })),
    ).toBe("co-host");
    expect(personPart(person({ ...member, parts: [role("mc")] }))).toBe("mc");
    expect(personPart(person(member))).toBe("people");
    expect(personCardGround(personCardFacts(person(member)))).toBe(
      built.og.cards.person.people,
    );
  });

  test("sets their name large, their title under it and their handle at the foot", () => {
    const texts = layout();
    expect(texts.map(({ font, text }) => [font, text])).toEqual([
      ["meta", "@esthor"],
      ["lead", "Head of Developer Experience, CodeRabbit"],
      ["lockup", "Erik"],
    ]);
    const [handle, title, name] = texts;
    expect(name?.size).toBe(112);
    expect(name?.color).toBe(roleColor(tokens, "night", "text").hex);
    expect(title?.color).toBe(resolveColor(tokens, "{color.mist}").hex);
    expect(handle?.color).toBe(roleColor(tokens, "night", "link").hex);
    // The handle sits on the photo's foot, the title above it.
    const box = built.og.personPhoto;
    const baseline = (run: (typeof texts)[number] | undefined) =>
      (run?.top ?? 0) +
      (measured[run?.font ?? "meta"].ascent * (run?.size ?? 0)) / 1000;
    expect(Math.abs(baseline(handle) - (box.top + box.side))).toBeLessThan(1);
    expect(baseline(title)).toBeLessThan(baseline(handle));
  });

  test("leaves out what their profile leaves empty, never an empty line", () => {
    const noHandle = layout({
      links: { x: null, bluesky: null, linkedin: null },
    });
    expect(noHandle.map(({ font }) => font)).toEqual(["lead", "lockup"]);
    // The title takes the foot.
    expect(noHandle[0]?.top).toBeGreaterThan(layout()[1]?.top ?? 0);
    expect(
      layout({
        title: null,
        links: { x: null, bluesky: null, linkedin: null },
      }).map(({ font }) => font),
    ).toEqual(["lockup"]);
    expect(layout({ title: "  " }).map(({ font }) => font)).toEqual([
      "meta",
      "lockup",
    ]);
  });

  test("keeps every word in its column, beside the photo, inside the margins", () => {
    for (const overrides of [
      {},
      { name: "Maximiliano Thorelli" },
      { name: "Dr. Bartholomew Featherstone-Cholmondeley" },
      { name: "a".repeat(60) },
      { title: "Head of Developer Community and Education" },
      { title: "Chief Technology Officer and Co-founder, A Very Long Company" },
      {
        links: {
          x: "https://x.com/abcdefghijklmno",
          bluesky: null,
          linkedin: null,
        },
      },
    ]) {
      const texts = layout(overrides);
      for (const run of texts) {
        expect(run.left).toBeGreaterThanOrEqual(60);
        expect(
          run.left + textWidth(measured[run.font], run.text, run.size),
        ).toBeLessThanOrEqual(column);
        // Under the wordmark, whose baseline is at 210.
        expect(run.top).toBeGreaterThan(210);
        expect(run.top + run.size).toBeLessThanOrEqual(cardHeight - 40);
      }
      // The name never runs into the title.
      const name = texts.filter(({ font }) => font === "lockup");
      const title = texts.find(({ font }) => font === "lead");
      const last = name.at(-1);
      expect(name.length).toBeLessThanOrEqual(2);
      if (title !== undefined && last !== undefined) {
        expect(last.top + last.size).toBeLessThanOrEqual(title.top);
      }
    }
  });

  test("sets a long first name smaller rather than cutting it, and a long name on two lines", () => {
    const long = layout({ name: "Maximiliano Thorelli" });
    expect(long.find(({ font }) => font === "lockup")).toMatchObject({
      text: "Maximiliano",
    });
    expect(long.find(({ font }) => font === "lockup")?.size).toBeLessThan(112);
    // "Hopper" alone fits at 112, but the name takes three lines there.
    const name = layout({ name: "Dr. Grace Hopper" }).filter(
      ({ font }) => font === "lockup",
    );
    expect(name.map(({ text, size }) => [text, size])).toEqual([
      ["Dr. Grace", 96],
      ["Hopper", 96],
    ]);
    const endless = layout({ name: `${"a".repeat(30)} ${"b".repeat(30)} c` });
    expect(
      endless.filter(({ font }) => font === "lockup").at(-1)?.text,
    ).toEndWith("…");
  });

  test("cuts a title too long for one line with an ellipsis", () => {
    const title = layout({
      title: "Chief Technology Officer and Co-founder, A Very Long Company",
    }).find(({ font }) => font === "lead");
    expect(title?.size).toBe(26);
    expect(title?.text).toEndWith("…");
  });

  test("draws their photo from the media origin, or the blank avatar for one elsewhere", () => {
    expect(personCardFacts(person()).photo).toEqual({
      key: "profiles/erik.jpg",
      version: "1760000000",
    });
    expect(
      personCardFacts(
        person({
          photo: {
            url: "https://elsewhere.example/zed.jpg",
            alt: "",
            width: 1,
            height: 1,
            version: "1",
          },
        }),
      ).photo,
    ).toBeNull();
    expect(personCardFacts(person({ photo: null })).photo).toBeNull();
  });

  test("is named by their page with a version that changes when what it shows does", () => {
    const card = personCard(person());
    expect(card).toEqual({
      src: `/og/people/erik-thorelli.png?v=${personCardVersion(personCardFacts(person()))}`,
      width: 1200,
      height: 630,
      alt: "Erik Thorelli · Head of Developer Experience, CodeRabbit · @esthor · allthings/_",
    });
    const version = (overrides: Partial<PersonPage>) =>
      personCard(person(overrides)).src;
    // A new title, handle, photo or part is a new card.
    expect(version({ title: "Engineering Leader" })).not.toBe(card.src);
    expect(
      version({
        links: { x: "https://x.com/erik", bluesky: null, linkedin: null },
      }),
    ).not.toBe(card.src);
    expect(
      version({
        photo: { ...(person().photo ?? ({} as never)), version: "1760000001" },
      }),
    ).not.toBe(card.src);
    expect(version({ organizes: false })).not.toBe(card.src);
    // What the card doesn't show doesn't change it.
    expect(version({ bio: "Another bio." })).toBe(card.src);
    expect(version({ name: "Erik Q. Thorelli" })).toBe(card.src);
  });
});
