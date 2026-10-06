import { personSlug } from "allthings-core/src/person-slug.ts";
import { describe, expect, test } from "bun:test";
import type {
  PeopleView,
  Person,
} from "allthings-core/src/people-directory.ts";
import { DateTime } from "effect";
import { peoplePage } from "../src/pages/people.tsx";
import type { ImageMode } from "../src/pages/picture.tsx";
import { headingLevels, htmlProblems } from "./support/pages.ts";

/** The people page as a pure function of fixed data. */

const origin = "https://allthingsweb.dev";

const person = (name: string, overrides: Partial<Person> = {}): Person => ({
  id: name,
  slug: personSlug(overrides.name ?? name),
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
        curation: "ours",
        name: "All Things Effect",
        topic: "effect",
        status: "past",
        startsAt: DateTime.makeUnsafe("2026-03-08T07:30:00Z"),
      },
    },
  ],
  ...overrides,
});

const render = (people: PeopleView, images: ImageMode = "originals") =>
  peoplePage({
    people,
    origin,
    theme: undefined,
    portraits: new Map(),
    images,
  });

const photo = (name: string, side = 1200) => ({
  url: `https://media.allthings.dev/profiles/${name}.png`,
  alt: name,
  width: side,
  height: side,
  version: "1767323045",
});

const view: PeopleView = {
  organizers: [person("Erik"), person("Andre", { parts: [] })],
  speakers: [person("Ada")],
  coHosts: [],
};

describe("the people page's portraits as variants", () => {
  const squares = (name: string, format: string, sides: Array<number>) =>
    sides
      .map(
        (side) =>
          `/img/${side}x${side}/${format}/1767323045/profiles/${name}.png ${side}w`,
      )
      .join(", ");
  const html = render(
    {
      organizers: [person("erik", { photo: photo("erik") })],
      speakers: [
        person("ada", { photo: photo("ada") }),
        person("kit", { photo: photo("kit", 100) }),
        person("zed", {
          photo: { ...photo("zed"), url: "https://elsewhere.example/zed.png" },
        }),
      ],
      coHosts: [],
    },
    "variants",
  );

  test("offer organizers at 168 and 336 pixels square, loaded at once", () => {
    const sizes = "(max-width: 1023.98px) 96px, 168px";
    expect(html).toContain(
      [
        "<picture>",
        `<source type="image/avif" srcset="${squares("erik", "avif", [168, 336])}" sizes="${sizes}"/>`,
        `<source type="image/webp" srcset="${squares("erik", "webp", [168, 336])}" sizes="${sizes}"/>`,
        `<img class="portrait" src="/img/168x168/jpeg/1767323045/profiles/erik.png" srcset="${squares("erik", "jpeg", [168, 336])}" sizes="${sizes}" alt="" width="168" height="168" decoding="async"/>`,
        "</picture>",
      ].join(""),
    );
  });

  test("offer everyone else at 72 to 216 pixels square, loaded as they're scrolled to", () => {
    const sizes = "72px";
    expect(html).toContain(
      `<img class="portrait" src="/img/72x72/jpeg/1767323045/profiles/ada.png" srcset="${squares("ada", "jpeg", [72, 144, 216])}" sizes="${sizes}" alt="" width="72" height="72" loading="lazy" decoding="async"/>`,
    );
    // A photo smaller than every square comes at the smallest.
    expect(html).toContain(`srcset="${squares("kit", "avif", [72])}"`);
  });

  test("show the blank avatar for a photo the Worker can't make variants of, and load nothing from elsewhere", async () => {
    expect(html).not.toContain("elsewhere.example");
    expect(html).not.toContain("media.allthings.dev");
    expect(
      html.match(/<img class="portrait" src="\/assets\/avatar\./g),
    ).toHaveLength(1);
    expect(await htmlProblems(html)).toEqual([]);
  });
});

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
                curation: "ours",
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
      curation: "ours" as const,
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
