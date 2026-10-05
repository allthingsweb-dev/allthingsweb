import { describe, expect, test } from "bun:test";
import type {
  PeopleView,
  Person,
} from "allthings-core/src/people-directory.ts";
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
  parts: [
    {
      kind: "talk",
      title: "Typed errors",
      role: "speaker",
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
  organizers: [person("Erik"), person("Andre", { parts: [] })],
  speakers: [person("Ada")],
  coHosts: [],
};

describe("the people page", () => {
  test("gives each person an anchor from their profile's id, never their name", async () => {
    const html = render({
      organizers: [person("Erik", { id: "717803b9", parts: [] })],
      speakers: [person("Ada", { id: "b0000001" })],
      coHosts: [person("Ada", { id: "b0000002", parts: [] })],
    });
    expect(html).toContain('<li class="person" id="p-717803b9">');
    expect(html).toContain('<li class="person" id="p-b0000001">');
    // Two people may share a name; their anchors still differ.
    expect(html).toContain('<li class="person" id="p-b0000002">');
    expect(await htmlProblems(html)).toEqual([]);
  });

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
      coHosts: [],
      speakers: [
        person("Ada", {
          parts: [
            {
              kind: "talk",
              title: "After hours",
              role: "speaker",
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
    expect(html).toContain(`<a class="talk" href="/party">`);
  });

  test("names each part: a talk in its capacity unless spoken, an evening role by its name", () => {
    const evening = (slug: string) => ({
      slug,
      name: "All Things Effect",
      topic: "effect",
      status: "past" as const,
      startsAt: DateTime.makeUnsafe("2026-03-08T07:30:00Z"),
    });
    const html = render({
      organizers: [],
      speakers: [
        person("Ada", {
          parts: [
            {
              kind: "talk",
              title: "Effect 4",
              role: "moderator",
              evening: evening("a"),
            },
            {
              kind: "talk",
              title: "Typed",
              role: "speaker",
              evening: evening("b"),
            },
          ],
        }),
      ],
      coHosts: [
        person("Mia", {
          parts: [
            { kind: "role", role: "mc", evening: evening("c") },
            { kind: "role", role: "co-host", evening: evening("d") },
          ],
        }),
      ],
    });
    expect(html).toContain(
      '<span class="talk-title">Effect 4</span><span class="talk-evening">at<span class="slash">/</span><span>effect</span><span class="talk-role at-type-meta"> · moderator</span></span>',
    );
    expect(html.match(/talk-role/g)).toHaveLength(1);
    expect(html).toContain(
      '<h2 id="co-hosts" class="list-title at-type-meta">Co-hosts and MCs</h2>',
    );
    expect(html).toContain(
      `<a class="talk" href="/c"><time class="date at-type-meta" datetime="2026-03-08T07:30:00.000Z">03.07.26</time><span class="talk-title">MC</span>`,
    );
    expect(html).toContain('<span class="talk-title">co-host</span>');
  });

  test("has one h1, then a heading per group and per person", () => {
    expect(headingLevels(render(view))).toEqual([1, 2, 3, 3, 2, 3]);
  });

  test("leaves out a group with nobody in it", async () => {
    const html = render({
      organizers: [],
      speakers: [person("Ada")],
      coHosts: [],
    });
    expect(html).not.toContain("Organizers");
    expect(await htmlProblems(html)).toEqual([]);
    expect(
      render({ organizers: [person("Erik")], speakers: [], coHosts: [] }),
    ).not.toContain("Speakers");
  });

  test("escapes what it prints", () => {
    const html = render({
      organizers: [],
      coHosts: [],
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
    ["nobody", { organizers: [], speakers: [], coHosts: [] }],
  ])("is valid HTML: %s", async (_, people) => {
    expect(await htmlProblems(render(people))).toEqual([]);
  });
});
