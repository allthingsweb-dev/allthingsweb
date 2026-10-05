import { describe, expect, test } from "bun:test";
import type { AboutView, Organizer } from "allthings-core/src/about.ts";
import type { Evening } from "allthings-core/src/home.ts";
import { DateTime } from "effect";
import { discord, socials } from "../src/links.ts";
import { aboutPage, count } from "../src/pages/about.tsx";
import { headingLevels, htmlProblems } from "./support/pages.ts";

/** The about page as a pure function of fixed data. */

const origin = "https://allthings.dev";

const evening = (slug: string, name: string, iso: string): Evening => ({
  slug,
  name,
  topic: undefined,
  status: "past",
  startsAt: DateTime.makeUnsafe(iso),
  neighborhood: "Union Square",
  hosts: [],
  rsvpUrl: null,
  curation: { kind: "ours" },
});

const remix = evening(
  "2024-03-26-remix-bay-area-at-solv",
  "Remix Bay Area at Solv",
  "2024-03-27T00:00:00Z",
);
const react = evening(
  "2024-07-30-react-bay-area-at-sanity",
  "React Bay Area at Sanity",
  "2024-07-31T00:00:00Z",
);
const web = evening(
  "2024-11-04",
  "All Things Web at Little Skillet",
  "2024-11-05T01:00:00Z",
);

const organizer = (
  name: string,
  overrides: Partial<Organizer> = {},
): Organizer => ({
  id: name.toLowerCase(),
  name,
  title: "Organizer",
  bio: `${name} organizes the evenings.`,
  links: {
    x: `https://twitter.com/${name.toLowerCase()}`,
    bluesky: null,
    linkedin: `https://www.linkedin.com/in/${name.toLowerCase()}`,
  },
  photo: null,
  ...overrides,
});

const view = (overrides: Partial<AboutView> = {}): AboutView => ({
  evenings: 36,
  speakers: 61,
  hostingCompanies: 24,
  guests: 8215,
  first: remix,
  formerNames: [
    { name: "Remix Bay Area", evening: remix },
    { name: "React Bay Area", evening: react },
    { name: "All Things Web", evening: web },
  ],
  organizers: [organizer("Erik"), organizer("Andre")],
  ...overrides,
});

const render = (about: AboutView, theme?: "light" | "dark") =>
  aboutPage({
    about,
    origin,
    theme,
    portraits: new Map(),
    images: "originals",
  });

/** The part headed `id`, or "" when the page has none. */
function part(html: string, id: string): string {
  const start = html.indexOf(`aria-labelledby="${id}"`);
  return start === -1
    ? ""
    : html.slice(start, html.indexOf("</section>", start));
}

describe("count", () => {
  test.each([
    [0, "0"],
    [999, "999"],
    [1000, "1,000"],
    [8215, "8,215"],
    [1234567, "1,234,567"],
  ])("%d reads %s", (value, text) => {
    expect(count(value)).toBe(text);
  });
});

describe("the about page", () => {
  test("says who we are in the foundations' words, under the two sentences", () => {
    const html = render(view());
    expect(html).toContain(
      '<h1 class="lockup at-type-event-lockup">about</h1><div class="pitch at-type-lead"><p>Evenings for people who build software.</p><p class="pitch-place">In the neighborhoods of San Francisco.</p></div>',
    );
    const who = part(html, "who");
    expect(who).toContain("An open door and a high bar.");
    expect(who).toContain("What goes on stage has earned its place.");
    expect(who).toContain(
      "We have never taken money or sold a stage, so we never call anyone a sponsor.",
    );
    expect(html).toContain("<title>about · all things/_</title>");
    expect(html).toContain(
      '<link rel="canonical" href="https://allthings.dev/about"/>',
    );
  });

  test("counts what has happened so far from the data, and says since when", () => {
    const soFar = part(render(view()), "so-far");
    expect(
      [
        ...soFar.matchAll(
          /<dt class="at-type-meta">([^<]+)<\/dt><dd>([^<]+)</g,
        ),
      ].map(([, label, value]) => [label, value]),
    ).toEqual([
      ["evenings", "36"],
      ["people on stage", "61"],
      ["hosting companies", "24"],
      ["guests, as Luma counted them", "8,215"],
    ]);
    expect(soFar).toContain(
      'since <time datetime="2024-03-27T00:00:00.000Z">Tue Mar 26, 2024</time>',
    );
  });

  test("leaves out a number that is nothing, and the whole tally before anything has happened", () => {
    const quiet = part(render(view({ guests: 0 })), "so-far");
    expect(quiet).not.toContain("guests");
    expect(quiet).toContain(">evenings<");
    const html = render(
      view({
        evenings: 0,
        speakers: 0,
        hostingCompanies: 0,
        guests: 0,
        first: undefined,
        formerNames: [],
      }),
    );
    expect(part(html, "so-far")).toBe("");
    expect(part(html, "history")).not.toContain("went by");
  });

  test("tells where it came from with the names the data shows, each linked to its first evening", () => {
    const history = part(render(view()), "history");
    expect(history).toContain(
      "Before they were all things, they went by Remix Bay Area, React Bay Area and All Things Web.",
    );
    expect(
      [...history.matchAll(/<a class="row" href="([^"]+)">/g)].map(
        ([, href]) => href,
      ),
    ).toEqual([
      "/2024-03-26-remix-bay-area-at-solv",
      "/2024-07-30-react-bay-area-at-sanity",
      "/2024-11-04",
    ]);
    expect(history).toContain(
      '<span class="name at-type-list-name">All Things Web at Little Skillet</span>',
    );
    const two = part(
      render(
        view({ formerNames: [{ name: "React Bay Area", evening: react }] }),
      ),
      "history",
    );
    expect(two).toContain("they went by React Bay Area.");
  });

  test("names the old names only in its history", () => {
    const html = render(view());
    const body = html.slice(html.indexOf("<body>"));
    const outside = body.replace(part(html, "history"), "");
    for (const name of ["All Things Web", "Remix Bay Area", "React Bay Area"]) {
      expect(outside).not.toContain(name);
    }
  });

  test("shows the organizers whole, linked to their people entries", () => {
    const organizers = part(render(view()), "organizers");
    expect(organizers).toContain(
      '<h3 class="person-name"><a href="/people#p-erik">Erik</a></h3>',
    );
    expect(organizers).toContain(
      '<p class="person-bio">Erik organizes the evenings.</p>',
    );
    expect(organizers).toContain(
      '<a href="https://twitter.com/erik"><span>x</span><span class="visually-hidden">, Erik</span></a>',
    );
    expect(organizers).not.toContain("bluesky");
    // The blank avatar stands in for a missing photo.
    expect(organizers).toMatch(
      /<img class="portrait" src="\/assets\/avatar\.[0-9a-f]{16}\.svg" alt=""/,
    );
    expect(part(render(view({ organizers: [] })), "organizers")).toBe("");
  });

  test("asks companies to host and people to take the stage on the channels we have, with no form", () => {
    const html = render(view());
    expect(part(html, "host")).toContain(`<a href="${discord}">ask on discord`);
    expect(part(html, "stage")).toContain(
      `<a href="${discord}">pitch a talk on discord`,
    );
    expect(html).not.toMatch(/<form|<input|<button/);
    expect(html).not.toMatch(/RSVP|sponsored|partners/i);
  });

  test("lists every channel, in the footer's order", () => {
    const elsewhere = part(render(view()), "elsewhere");
    expect(
      [...elsewhere.matchAll(/<li><a href="([^"]+)">([^<]+)<\/a><\/li>/g)].map(
        ([, href, name]) => ({ name, href }),
      ),
    ).toEqual([...socials]);
    expect(socials.map((social) => social.name)).toEqual([
      "luma",
      "discord",
      "youtube",
      "github",
      "x",
      "bluesky",
      "linkedin",
    ]);
  });

  test("escapes what it prints", () => {
    const html = render(
      view({
        organizers: [
          organizer("<script>x</script>", {
            bio: "a < b",
            // Links arrive as URLs core has parsed (mappers.ts).
            links: { x: null, bluesky: null, linkedin: null },
          }),
        ],
      }),
    );
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("a &lt; b");
  });

  test.each([
    ["the system's mode", undefined],
    ["Paper", "light"],
    ["Night", "dark"],
  ] as const)(
    "is valid HTML with one h1 and headings in order, in %s",
    async (_, theme) => {
      const html = render(view(), theme);
      expect(await htmlProblems(html)).toEqual([]);
      const levels = headingLevels(html);
      expect(levels.filter((level) => level === 1)).toHaveLength(1);
      levels.forEach((level, index) => {
        expect(level).toBeLessThanOrEqual((levels[index - 1] ?? 0) + 1);
      });
      if (theme !== undefined) {
        expect(html).toStartWith(
          `<!doctype html><html lang="en" data-theme="${theme}">`,
        );
      }
    },
  );
});

describe("the about page's portraits as variants", () => {
  test("offers the organizers at 168 and 336 pixels square, loaded as they're scrolled to", () => {
    const photo = {
      url: "https://media.allthings.dev/profiles/erik.png",
      alt: "Erik",
      width: 1200,
      height: 1200,
      version: "1767323045",
    };
    const html = aboutPage({
      about: view({ organizers: [organizer("Erik", { photo })] }),
      origin,
      theme: undefined,
      portraits: new Map(),
      images: "variants",
    });
    expect(html).toContain(
      '<img class="portrait" src="/img/168x168/jpeg/1767323045/profiles/erik.png" srcset="/img/168x168/jpeg/1767323045/profiles/erik.png 168w, /img/336x336/jpeg/1767323045/profiles/erik.png 336w" sizes="(max-width: 599.98px) 96px, 168px" alt="" width="168" height="168" loading="lazy" decoding="async"/>',
    );
    expect(html).not.toContain("media.allthings.dev");
  });
});
