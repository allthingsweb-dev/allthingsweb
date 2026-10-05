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
    [...html.matchAll(/<li class="person">[\s\S]*?<\/div><\/li>/g)].map(
      ([entry]) => [/<h3[^>]*>([^<]*)<\/h3>/.exec(entry)?.[1] ?? "", entry],
    ),
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
      '<span class="talk-title">Shipping AI</span><span class="talk-evening">at<span class="slash">/</span><span>ship ai</span><span class="talk-role at-type-meta"> · panelist</span></span>',
    );
    expect(entries(section(html, "co-hosts")).get("Mia MC")).toContain(
      `<a class="talk" href="${origin}/next-effect-sf">`,
    );
    expect(entries(section(html, "co-hosts")).get("Mia MC")).toContain(
      '<span class="talk-title">MC</span><span class="talk-evening">at<span class="slash">/</span><span>effect</span><span class="at-cursor" aria-hidden="true">_</span></span>',
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
      `${origin}/next-effect-sf`,
      `${origin}/2026-03-07-all-things-effect`,
    ]);
    // Next week's evening carries the cursor; March's doesn't.
    expect(adaTalks[0]?.[2]).toContain(
      '<span class="talk-title">Effect in production</span><span class="talk-evening">at<span class="slash">/</span><span>effect</span><span class="at-cursor" aria-hidden="true">_</span></span>',
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
