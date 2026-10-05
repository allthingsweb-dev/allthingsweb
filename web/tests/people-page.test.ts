import { describe, expect, test } from "bun:test";
import type { PeopleView, Person } from "allthings-core/src/people.ts";
import { DateTime } from "effect";
import { peoplePage } from "../src/pages/people.tsx";
import { headingLevels, htmlProblems } from "./support/pages.ts";

/** The people page as a pure function of fixed data. */

const origin = "https://allthingsweb.dev";

const person = (name: string, overrides: Partial<Person> = {}): Person => ({
  id: name,
  name,
  title: "Engineer",
  bio: "Writes compilers for the analytical engine, mostly at night. Also teaches.",
  links: { x: null, bluesky: null, linkedin: "https://www.linkedin.com/in/a" },
  photo: null,
  talks: [
    {
      title: "Typed errors",
      evening: {
        slug: "2026-03-07-all-things-effect",
        name: "All Things Effect",
        topic: "effect",
        status: "past",
        startsAt: DateTime.makeUnsafe("2026-03-08T07:30:00Z"),
      },
    },
  ],
  ...overrides,
});

const render = (people: PeopleView) =>
  peoplePage({ people, origin, theme: undefined, portraits: new Map() });

const view: PeopleView = {
  organizers: [person("Erik"), person("Andre", { talks: [] })],
  speakers: [person("Ada")],
};

describe("the people page", () => {
  test("shows organizers' bios whole and speakers' short", () => {
    const html = render(view);
    const whole =
      "Writes compilers for the analytical engine, mostly at night. Also teaches.";
    expect(html.split(whole)).toHaveLength(3);
    expect(html).toContain(
      '<p class="person-bio">Writes compilers for the analytical engine, mostly at night.</p>',
    );
  });

  test("names an evening without a topic as written, with the cursor until it has happened", () => {
    const html = render({
      organizers: [],
      speakers: [
        person("Ada", {
          talks: [
            {
              title: "After hours",
              evening: {
                slug: "party",
                name: "TypeScript AI: The official conference after-party",
                topic: undefined,
                status: "upcoming",
                startsAt: DateTime.makeUnsafe("2026-11-06T02:00:00Z"),
              },
            },
          ],
        }),
      ],
    });
    expect(html).toContain(
      '<span class="talk-evening"><span>TypeScript AI: The official conference after-party</span><span class="at-cursor" aria-hidden="true">_</span></span>',
    );
    expect(html).toContain(`<a class="talk" href="${origin}/party">`);
  });

  test("has one h1, then a heading per group and per person", () => {
    expect(headingLevels(render(view))).toEqual([1, 2, 3, 3, 2, 3]);
  });

  test("leaves out a group with nobody in it", async () => {
    const html = render({ organizers: [], speakers: [person("Ada")] });
    expect(html).not.toContain("Organizers");
    expect(await htmlProblems(html)).toEqual([]);
    expect(
      render({ organizers: [person("Erik")], speakers: [] }),
    ).not.toContain("Speakers");
  });

  test("escapes what it prints", () => {
    const html = render({
      organizers: [],
      speakers: [
        person("<script>alert(1)</script>", {
          title: '"Acme" & <Co>',
          bio: "<img src=x onerror=alert(1)>",
        }),
      ],
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&quot;Acme&quot; &amp; &lt;Co&gt;");
  });

  test.each([
    ["everyone", view],
    ["nobody", { organizers: [], speakers: [] }],
  ])("is valid HTML: %s", async (_, people) => {
    expect(await htmlProblems(render(people))).toEqual([]);
  });
});
