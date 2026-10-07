import { describe, expect } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { CacheControl, PrivateCacheControl } from "../src/cache.ts";
import { hosts, mediaOrigin } from "../src/links.ts";
import { contentSecurityPolicy } from "../src/pages/response.ts";
import { catalogDatabase, erikPortrait } from "./support/catalog.ts";
import {
  cssBudget,
  gzipped,
  headingLevels,
  htmlBudget,
  htmlProblems,
  stylesheetOf,
  stylesheetUrls,
  subresources,
} from "./support/pages.ts";
import { serve } from "./support/socket.ts";
import { testStack } from "./support/stack.ts";

/**
 * The people page, served by the Worker in workerd, reading PGlite over
 * TCP as it will read Hyperdrive: the home page's catalog with talks
 * added. Erik has a photo, a bio and a talk; Andre's profile has neither
 * title nor bio. Ada speaks next week and spoke in March, Grace's profile
 * is empty and her talk was a panel, Zed's photo is on another origin, Mia
 * MCs next week without a talk, and a draft's people must never show.
 */

const origin = "https://allthings.dev";
const startedAt = new Date();

const adaPortrait = `${mediaOrigin}/profiles/ada.jpg`;

const talks = `
  UPDATE profiles SET title = 'Engineering Leader', bio = 'Erik organizes the evenings. He builds apps.', twitter_handle = 'esthor'
    WHERE id = '${hosts[0].profileId}';
  INSERT INTO images (id, url, placeholder, alt, width, height, updated_at) VALUES
    ('d0000000-0000-4000-8000-000000000501', '${adaPortrait}', '', 'Ada Lovelace', 400, 400, now()),
    ('d0000000-0000-4000-8000-000000000502', 'https://elsewhere.example/zed.jpg', '', 'Zed', 400, 400, now());
  INSERT INTO profiles (id, name, title, image, twitter_handle, bluesky_handle, linkedin_handle, bio, profile_type, updated_at) VALUES
    ('b0000000-0000-4000-8000-000000000501', 'Ada Lovelace', 'Engineer', 'd0000000-0000-4000-8000-000000000501', 'ada', 'ada.bsky.social', 'ada-lovelace', 'Ada writes compilers for the analytical engine, mostly at night. She also teaches.', 'member', now()),
    ('b0000000-0000-4000-8000-000000000502', 'Grace Hopper', '', NULL, NULL, NULL, NULL, '', 'member', now()),
    ('b0000000-0000-4000-8000-000000000503', 'Zed Nobody', 'Hacker', 'd0000000-0000-4000-8000-000000000502', NULL, NULL, NULL, 'Hacks.', 'member', now()),
    ('b0000000-0000-4000-8000-000000000504', 'Draft Speaker', 'Ghost', NULL, NULL, NULL, NULL, 'Hidden.', 'member', now()),
    ('b0000000-0000-4000-8000-000000000505', 'Mia MC', '', NULL, NULL, NULL, NULL, '', 'member', now()),
    ('b0000000-0000-4000-8000-000000000506', 'Draft Host', '', NULL, NULL, NULL, NULL, '', 'member', now());
  INSERT INTO event_people (event_id, profile_id, role, position, source, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000101', 'b0000000-0000-4000-8000-000000000505', 'mc', 0, 'site', now()),
    ('e0000000-0000-4000-8000-000000000301', 'b0000000-0000-4000-8000-000000000506', 'co-host', 0, 'luma', now());
  INSERT INTO talks (id, title, description, updated_at) VALUES
    ('a0000000-0000-4000-8000-000000000501', 'Effect in production', '', now()),
    ('a0000000-0000-4000-8000-000000000502', 'Typed errors', '', now()),
    ('a0000000-0000-4000-8000-000000000503', 'Shipping AI', '', now()),
    ('a0000000-0000-4000-8000-000000000504', 'React at Mux', '', now()),
    ('a0000000-0000-4000-8000-000000000505', 'A secret', '', now()),
    ('a0000000-0000-4000-8000-000000000506', 'Hosting evenings', '', now());
  INSERT INTO talk_speakers (talk_id, speaker_id, created_at, updated_at) VALUES
    ('a0000000-0000-4000-8000-000000000501', 'b0000000-0000-4000-8000-000000000501', now(), now()),
    ('a0000000-0000-4000-8000-000000000502', 'b0000000-0000-4000-8000-000000000501', now(), now()),
    ('a0000000-0000-4000-8000-000000000503', 'b0000000-0000-4000-8000-000000000502', now(), now()),
    ('a0000000-0000-4000-8000-000000000504', 'b0000000-0000-4000-8000-000000000503', now(), now()),
    ('a0000000-0000-4000-8000-000000000505', 'b0000000-0000-4000-8000-000000000504', now(), now()),
    ('a0000000-0000-4000-8000-000000000506', '${hosts[0].profileId}', now(), now());
  UPDATE talks SET format = 'panel' WHERE id = 'a0000000-0000-4000-8000-000000000503';
  INSERT INTO event_talks (event_id, talk_id, created_at, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000101', 'a0000000-0000-4000-8000-000000000501', now(), now()),
    ('e0000000-0000-4000-8000-000000000201', 'a0000000-0000-4000-8000-000000000502', now(), now()),
    ('e0000000-0000-4000-8000-000000000202', 'a0000000-0000-4000-8000-000000000503', now(), now()),
    ('e0000000-0000-4000-8000-000000000203', 'a0000000-0000-4000-8000-000000000504', now(), now()),
    ('e0000000-0000-4000-8000-000000000302', 'a0000000-0000-4000-8000-000000000505', now(), now()),
    ('e0000000-0000-4000-8000-000000000204', 'a0000000-0000-4000-8000-000000000506', now(), now());`;

const db = await catalogDatabase(startedAt, true);
await db.exec(talks);
// Erik organized the live evening, and MC'd it; Ruth changed her name, so
// her page moved.
await db.exec(`
  INSERT INTO event_people (event_id, profile_id, role, position, source, updated_at) VALUES
    ('e0000000-0000-4000-8000-000000000101', '${hosts[0].profileId}', 'organizer', 0, 'site', now()),
    ('e0000000-0000-4000-8000-000000000101', '${hosts[0].profileId}', 'mc', 0, 'site', now());
  INSERT INTO profiles (id, name, title, bio, profile_type, updated_at) VALUES
    ('b0000000-0000-4000-8000-000000000507', 'Ruth Old', '', '', 'member', now());
  UPDATE profiles SET name = 'Ruth New' WHERE id = 'b0000000-0000-4000-8000-000000000507';
  INSERT INTO external_talks (profile_id, title, event_name, kind, given_on, url, video_url, source_url, read_on, updated_at) VALUES
    ('b0000000-0000-4000-8000-000000000501', 'Engines that think', 'JSConf', 'conference', '2025-05-01', 'https://jsconf.example/engines', 'https://video.example/engines', 'https://jsconf.example/engines', '2026-10-01', now()),
    ('b0000000-0000-4000-8000-000000000501', 'Notes on the engine', 'The Changelog', 'podcast', '2024-02-03', NULL, NULL, 'https://changelog.example/notes', '2026-10-01', now());`);
const database = await serve(db);

const Stack = testStack("allthings-web-people-test", {
  People: { ORIGIN: origin, DATABASE_URL: database.url },
  // Nothing listens on the discard port, so every connection is refused.
  Unreachable: {
    ORIGIN: origin,
    DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:9/postgres",
  },
});

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});
const workers = beforeAll(deploy(Stack));
afterAll(
  destroy(Stack).pipe(Effect.ensuring(Effect.promise(() => database.stop()))),
);

type Worker = "People" | "Unreachable";

/** A test that gets the running Workers' URLs. */
const it = (
  name: string,
  run: (urls: Record<Worker, string>) => Promise<void>,
) =>
  test(
    name,
    Effect.flatMap(workers, (outputs) =>
      Effect.promise(() => {
        const url = (worker: Worker) => {
          const value = outputs[worker];
          if (
            typeof value !== "string" ||
            !value.startsWith("http://localhost")
          ) {
            throw new Error(
              `${worker} is not running locally: ${String(value)}`,
            );
          }
          return value;
        };
        return run({
          People: url("People"),
          Unreachable: url("Unreachable"),
        });
      }),
    ),
  );

/** /people fetched with `init`, and its HTML. */
const people = async (url: string, init?: RequestInit) => {
  const response = await fetch(`${url}/people`, init);
  return { response, html: await response.text() };
};

/** The section headed `id`, or "" when the page has none. */
function section(html: string, id: string): string {
  const start = html.indexOf(`aria-labelledby="${id}"`);
  return start === -1
    ? ""
    : html.slice(start, html.indexOf("</section>", start));
}

/** Each person's entry in `html`, by name. */
function entries(html: string): Map<string, string> {
  return new Map(
    [
      ...html.matchAll(
        /<li class="person" id="p-[^"]+">[\s\S]*?<\/div><\/li>/g,
      ),
    ].map(([entry]) => [
      /<h3[^>]*><a href="\/people\/[^"]+">([^<]*)<\/a><\/h3>/.exec(
        entry,
      )?.[1] ?? "",
      entry,
    ]),
  );
}

const blankAvatar =
  /<img class="portrait" src="\/assets\/avatar\.[0-9a-f]{16}\.svg"/;

describe("/people", () => {
  it("answers with HTML cached like public data", async ({ People }) => {
    const { response } = await people(People);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(CacheControl.publicData);
    expect(response.headers.get("content-security-policy")).toBe(
      contentSecurityPolicy.originals,
    );
  });

  it("puts the organizers first, then every speaker, latest on stage first, then co-hosts and MCs", async ({
    People,
  }) => {
    const { html } = await people(People);
    // Each entry is anchored by the profile's id, which event pages link to.
    for (const host of hosts) {
      expect(section(html, "organizers")).toContain(
        `<li class="person" id="p-${host.profileId}">`,
      );
    }
    expect([...entries(section(html, "organizers")).keys()]).toEqual([
      "Erik Thorelli",
      "Andre Landgraf",
    ]);
    expect([...entries(section(html, "speakers")).keys()]).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
      "Zed Nobody",
    ]);
    expect([...entries(section(html, "co-hosts")).keys()]).toEqual(["Mia MC"]);
    expect(html.indexOf('id="organizers"')).toBeLessThan(
      html.indexOf('id="speakers"'),
    );
    expect(html.indexOf('id="speakers"')).toBeLessThan(
      html.indexOf('id="co-hosts"'),
    );
  });

  it("names a part by its capacity: a panelist, an MC", async ({ People }) => {
    const { html } = await people(People);
    expect(entries(section(html, "speakers")).get("Grace Hopper")).toContain(
      '<span class="talk-title">at<span class="slash">/</span><span>ship ai</span></span><span class="talk-parts">panelist: Shipping AI</span>',
    );
    expect(entries(section(html, "co-hosts")).get("Mia MC")).toContain(
      `<a class="talk" href="/next-effect-sf">`,
    );
    expect(entries(section(html, "co-hosts")).get("Mia MC")).toContain(
      '<span class="talk-title">at<span class="slash">/</span><span>effect</span><span class="at-cursor" aria-hidden="true">_</span></span><span class="talk-parts">MC</span>',
    );
  });

  it("shows the organizers as their profiles have them, whole", async ({
    People,
  }) => {
    const { html } = await people(People);
    const organizers = entries(section(html, "organizers"));
    const erik = organizers.get("Erik Thorelli") ?? "";
    expect(erik).toContain(
      `<img class="portrait" src="${erikPortrait}" alt=""`,
    );
    expect(erik).not.toContain('loading="lazy"');
    expect(erik).toContain(
      '<p class="person-title at-type-meta">Engineering Leader</p>',
    );
    expect(erik).toContain(
      '<p class="person-bio">Erik organizes the evenings. He builds apps.</p>',
    );
    expect(erik).toContain('<a href="https://twitter.com/esthor">x</a>');
    // His talk is listed with him, and not again among the speakers.
    expect(erik).toContain("Hosting evenings");
    expect(section(html, "speakers")).not.toContain("Hosting evenings");
    // Andre's profile has no photo, title, bio or links: only his name.
    const andre = organizers.get("Andre Landgraf") ?? "";
    expect(andre).toMatch(blankAvatar);
    expect(andre).not.toContain("person-title");
    expect(andre).not.toContain("person-bio");
    expect(andre).not.toContain("person-links");
    expect(andre).not.toContain("talks");
  });

  it("shows each speaker's portrait, title, short bio, links and talks", async ({
    People,
  }) => {
    const { html } = await people(People);
    const speakers = entries(section(html, "speakers"));
    const ada = speakers.get("Ada Lovelace") ?? "";
    expect(ada).toContain(
      `<img class="portrait" src="${adaPortrait}" alt="" width="72" height="72" loading="lazy" decoding="async"/>`,
    );
    expect(ada).toContain(
      '<p class="person-bio">Ada writes compilers for the analytical engine, mostly at night.</p>',
    );
    expect(ada).toContain(
      '<ul class="person-links at-type-meta"><li><a href="https://twitter.com/ada">x</a></li><li><a href="https://bsky.app/profile/ada.bsky.social">bluesky</a></li><li><a href="https://www.linkedin.com/in/ada-lovelace">linkedin</a></li></ul>',
    );
    const adaTalks = [
      ...ada.matchAll(/<a class="talk" href="([^"]+)">([\s\S]*?)<\/a>/g),
    ];
    expect(adaTalks.map(([, href]) => href)).toEqual([
      // Within the site, root-relative.
      "/next-effect-sf",
      "/2026-03-07-all-things-effect",
    ]);
    // Next week's evening carries the cursor; March's doesn't.
    expect(adaTalks[0]?.[2]).toContain(
      '<span class="talk-title">at<span class="slash">/</span><span>effect</span><span class="at-cursor" aria-hidden="true">_</span></span><span class="talk-parts">talk: Effect in production</span>',
    );
    expect(adaTalks[1]?.[2]).toContain(">03.07.26</time>");
    expect(adaTalks[1]?.[2]).not.toContain("at-cursor");
  });

  it("leaves out what a profile leaves empty, and shows no photo from another origin", async ({
    People,
  }) => {
    const { html } = await people(People);
    const speakers = entries(section(html, "speakers"));
    const grace = speakers.get("Grace Hopper") ?? "";
    expect(grace).toMatch(blankAvatar);
    expect(grace).not.toContain("person-title");
    expect(grace).not.toContain("person-bio");
    expect(grace).not.toContain("person-links");
    expect(grace).toContain(
      'at<span class="slash">/</span><span>ship ai</span>',
    );
    expect(speakers.get("Zed Nobody")).toMatch(blankAvatar);
    expect(html).not.toContain("elsewhere.example");
  });

  it("never shows a draft's people or talks", async ({ People }) => {
    const { html } = await people(People);
    expect(html).not.toContain("Draft Speaker");
    expect(html).not.toContain("Draft Host");
    expect(html).not.toContain("A secret");
  });

  it("is valid HTML, with one header, main, footer and h1, and headings in order", async ({
    People,
  }) => {
    const { html } = await people(People);
    expect(await htmlProblems(html)).toEqual([]);
    expect(html).toStartWith('<!doctype html><html lang="en">');
    for (const landmark of ["header", "main", "footer"]) {
      expect(html.match(new RegExp(`<${landmark}[ >]`, "g"))).toHaveLength(1);
    }
    const levels = headingLevels(html);
    expect(levels[0]).toBe(1);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    levels.forEach((level, index) => {
      expect(level).toBeLessThanOrEqual((levels[index - 1] ?? 0) + 1);
    });
    for (const image of html.match(/<img [^>]*>/g) ?? []) {
      expect(image).toMatch(/ alt="[^"]*"/);
    }
  });

  it(`gzips to at most ${htmlBudget} bytes of HTML and ${cssBudget} of CSS, runs no JavaScript and loads only this site and the media origin`, async ({
    People,
  }) => {
    const { html } = await people(People);
    const css = await (await fetch(`${People}${stylesheetOf(html)}`)).text();
    expect(gzipped(html)).toBeLessThanOrEqual(htmlBudget);
    expect(gzipped(css)).toBeLessThanOrEqual(cssBudget);
    expect(html).not.toMatch(/<script|\son[a-z]+=|javascript:/i);
    for (const path of [...subresources(html), ...stylesheetUrls(css)]) {
      if (path.startsWith("https:")) {
        expect(new URL(path).origin).toBe(mediaOrigin);
      } else {
        expect(path).toMatch(/^\/(?!\/)/);
      }
    }
  });

  it("says plainly when the people can't be read, and is never cached", async ({
    Unreachable,
  }) => {
    const { response, html } = await people(Unreachable);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe(CacheControl.failure);
    expect(await htmlProblems(html)).toEqual([]);
  });

  it("renders the mode its cookie fixes, for that visitor's browser alone", async ({
    People,
  }) => {
    const { response, html } = await people(People, {
      headers: { cookie: "theme=dark" },
    });
    expect(html).toStartWith(
      '<!doctype html><html lang="en" data-theme="dark">',
    );
    expect(response.headers.get("cache-control")).toBe(
      PrivateCacheControl.publicData,
    );
  });
});

describe("/speakers", () => {
  it("has moved to /people for good", async ({ People }) => {
    const response = await fetch(`${People}/speakers`, { redirect: "manual" });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/people");
    expect(response.headers.get("cache-control")).toBe(CacheControl.page);
    await response.arrayBuffer();
  });

  it("lands on the people page", async ({ People }) => {
    const response = await fetch(`${People}/speakers`);
    expect(response.status).toBe(200);
    expect(new URL(response.url).pathname).toBe("/people");
    expect(await response.text()).toContain(
      '<h1 class="lockup at-type-event-lockup">people</h1>',
    );
  });
});

describe("/people/<slug>", () => {
  it("shows one person whole: portrait, name, title, bio, links and every part", async ({
    People,
  }) => {
    const response = await fetch(`${People}/people/ada-lovelace`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(CacheControl.publicData);
    const html = await response.text();
    expect(await htmlProblems(html)).toEqual([]);
    expect(headingLevels(html).filter((level) => level === 1)).toHaveLength(1);
    expect(html).toContain('<h1 class="person-page-name">Ada Lovelace</h1>');
    expect(html).toContain('<p class="person-title at-type-meta">Engineer</p>');
    // The whole bio, not the people page's short one.
    expect(html).toContain(
      '<p class="person-page-bio">Ada writes compilers for the analytical engine, mostly at night. She also teaches.</p>',
    );
    expect(html).toContain(
      '<span class="talk-parts">talk: Effect in production</span>',
    );
    expect(html).toContain(
      '<span class="talk-parts">talk: Typed errors</span>',
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://allthings.dev/people/ada-lovelace"/>',
    );
    expect(html).toContain("<title>Ada Lovelace · allthings/_</title>");
    const jsonLd = JSON.parse(
      /<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)?.[1] ??
        "{}",
    );
    expect(jsonLd).toEqual({
      "@context": "https://schema.org",
      "@type": "Person",
      name: "Ada Lovelace",
      url: "https://allthings.dev/people/ada-lovelace",
      jobTitle: "Engineer",
      description:
        "Ada writes compilers for the analytical engine, mostly at night. She also teaches.",
      image: adaPortrait,
      sameAs: [
        "https://twitter.com/ada",
        "https://bsky.app/profile/ada.bsky.social",
        "https://www.linkedin.com/in/ada-lovelace",
      ],
    });
  });

  it("lists the talks they gave elsewhere, latest first, each linking where it can", async ({
    People,
  }) => {
    const html = await (await fetch(`${People}/people/ada-lovelace`)).text();
    expect(html).toContain(
      '<h2 id="elsewhere" class="at-type-meta">Talks elsewhere · 2 talks</h2>',
    );
    expect(html).toContain(
      '<li><a class="talk" href="https://jsconf.example/engines"><time class="date at-type-meta" datetime="2025-05-01">05.01.25</time><span class="talk-title">Engines that think</span><span class="talk-evening"><span>JSConf</span><span class="talk-role at-type-meta"> · conference</span></span></a><a class="talk-video at-type-meta" href="https://video.example/engines"><span>recording</span><span class="visually-hidden"> of Engines that think</span></a></li>',
    );
    // Without a page or a recording, the talk is listed, not linked.
    expect(html).toContain(
      '<li><div class="talk"><time class="date at-type-meta" datetime="2024-02-03">02.03.24</time><span class="talk-title">Notes on the engine</span>',
    );
    expect(html.indexOf("Engines that think")).toBeLessThan(
      html.indexOf("Notes on the engine"),
    );
    // Someone with none has no such section.
    const grace = await (await fetch(`${People}/people/grace-hopper`)).text();
    expect(grace).not.toContain("Talks elsewhere");
  });

  it("lists the evenings an organizer hosted, with an MC part on the evening, not apart", async ({
    People,
  }) => {
    const html = await (await fetch(`${People}/people/erik-thorelli`)).text();
    expect(html).toContain(
      '<h2 id="hosted" class="at-type-meta">Hosted · 1 evening</h2>',
    );
    expect(html).toContain(
      '<span>effect</span><span class="at-cursor" aria-hidden="true">_</span></span><span class="talk-parts">MC</span>',
    );
    // Hosting it says he was there: the MC part is no row of its own.
    expect(html.match(/<span class="talk-parts">MC<\/span>/g)).toHaveLength(1);
    const directory = await (await fetch(`${People}/people`)).text();
    expect(section(directory, "organizers")).not.toContain(
      '<span class="talk-parts">MC</span>',
    );
  });

  it("sends an old address to the new one for good", async ({ People }) => {
    const response = await fetch(`${People}/people/ruth-old`, {
      redirect: "manual",
    });
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("/people/ruth-new");
    expect(response.headers.get("cache-control")).toBe(CacheControl.page);
    expect((await fetch(`${People}/people/ruth-new`)).status).toBe(200);
  });

  it("is not found for a slug no one has had", async ({ People }) => {
    const response = await fetch(`${People}/people/no-one-at-all`);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe(CacheControl.notFound);
    const html = await response.text();
    // Said of a person, not an evening, with the way to everyone.
    expect(html).toContain(
      '<p class="lead at-type-lead">No one has this address.</p>',
    );
    expect(html).toContain(
      '<a href="/people">everyone <span aria-hidden="true">→</span></a>',
    );
  });

  it("says the data couldn't be read, and is never stored", async ({
    Unreachable,
  }) => {
    const response = await fetch(`${Unreachable}/people/ada-lovelace`);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe(CacheControl.failure);
    expect(await response.text()).toContain(
      "This person’s page didn’t load. Try again in a minute.",
    );
  });
});
