import { describe, expect } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import {
  CacheControl,
  PrivateCacheControl,
  preferenceCacheControl,
} from "../src/cache.ts";
import { contentSecurityPolicy } from "../src/pages/response.ts";
import { erikPortrait } from "./support/catalog.ts";
import {
  eventDatabase,
  eventPhoto,
  lumaPage,
  redirects,
  slugs,
  speakerPortrait,
} from "./support/event-catalog.ts";
import { serve } from "./support/socket.ts";
import { testStack } from "./support/stack.ts";

/**
 * Event pages, their calendar files and short links, served by the Worker
 * in workerd, reading PGlite over TCP as it will read Hyperdrive. The
 * catalog is written relative to now (support/event-catalog.ts).
 */

const origin = "https://allthings.dev";
const database = await serve(await eventDatabase(new Date()));

const Stack = testStack("allthings-web-event-test", {
  Events: { ORIGIN: origin, DATABASE_URL: database.url },
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

type Worker = "Events" | "Unreachable";

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
        return run({ Events: url("Events"), Unreachable: url("Unreachable") });
      }),
    ),
  );

/** `path` fetched with `init`, and its body as text. */
const get = async (url: string, path: string, init?: RequestInit) => {
  const response = await fetch(`${url}${path}`, init);
  return { response, html: await response.text() };
};

const page = (url: string, slug: string, init?: RequestInit) =>
  get(url, `/${encodeURIComponent(slug)}`, init);

/** The ledger's rows, by their labels, in order. */
const labels = (html: string) =>
  [...html.matchAll(/<dt class="at-type-meta">([^<]+)<\/dt>/g)].map(
    ([, label]) => label,
  );

/** The row labelled `label`, or "" when the page has none. */
function row(html: string, label: string): string {
  const start = html.indexOf(`<dt class="at-type-meta">${label}</dt>`);
  return start === -1 ? "" : html.slice(start, html.indexOf("</dd>", start));
}

describe("an upcoming evening", () => {
  it("answers with HTML cached like public data, in the system's mode", async ({
    Events,
  }) => {
    const { response, html } = await page(Events, slugs.upcoming);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(CacheControl.publicData);
    expect(response.headers.get("content-security-policy")).toBe(
      contentSecurityPolicy.originals,
    );
    expect(response.headers.get("vary")).toBe("accept-encoding, cookie");
    expect(html).toStartWith('<!doctype html><html lang="en"><head>');
    expect(html).toContain('<meta name="color-scheme" content="light dark"/>');
    expect(html).toContain("<title>all things/effect</title>");
  });

  it("leads with the lockup, the cursor after it, then names each fact once", async ({
    Events,
  }) => {
    const { html } = await page(Events, slugs.upcoming);
    expect(html).toContain(
      '<h1 class="event-name event-name-l">all things<span class="slash">/</span><wbr/><span>effect</span><span class="at-cursor" aria-hidden="true">_</span></h1>',
    );
    expect(labels(html)).toEqual([
      "When",
      "Where",
      "Hosted at",
      "Seats",
      "On stage",
    ]);
    expect(row(html, "Where")).toContain(
      '<p class="fact-head place">East Cut</p>',
    );
    // The venue is the host, which "Hosted at" names.
    expect(row(html, "Where")).not.toContain('class="venue"');
    expect(row(html, "Hosted at")).toContain(
      '<p class="fact-head">CodeRabbit</p>',
    );
    expect(row(html, "Seats")).toContain("<p>183 going · 200 seats</p>");
    expect(row(html, "Seats")).toContain(
      `<a class="button" href="${lumaPage}">I’m in<span class="visually-hidden">, on Luma</span><span aria-hidden="true">→</span></a>`,
    );
    expect(html).not.toMatch(/RSVP|see you/i);
  });

  it("links the address to Google Maps, encoded", async ({ Events }) => {
    const { html } = await page(Events, slugs.upcoming);
    expect(row(html, "Where")).toContain(
      '<a href="https://www.google.com/maps/search/?api=1&query=CodeRabbit%2C%20201%20Spear%20St%2012th%20floor%2C%20San%20Francisco%2C%20CA%2094105%2C%20USA"><span>201 Spear St 12th floor, San Francisco, CA 94105, USA</span><span class="visually-hidden">, on Google Maps</span></a>',
    );
  });

  it("offers its calendar file, which names the evening with the sign-off", async ({
    Events,
  }) => {
    const { html } = await page(Events, slugs.upcoming);
    expect(row(html, "When")).toContain(
      `<a href="/${slugs.upcoming}/calendar.ics" download="">add to calendar`,
    );
    const { response, html: ics } = await get(
      Events,
      `/${slugs.upcoming}/calendar.ics`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/calendar; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="${slugs.upcoming}.ics"`,
    );
    expect(response.headers.get("cache-control")).toBe(CacheControl.publicData);
    expect(ics).toStartWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n");
    expect(ics).toContain(
      "UID:e0000000-0000-4000-8000-000000000501@allthings.dev\r\n",
    );
    expect(ics).toContain("DTSTAMP:20260901T120000Z\r\n");
    expect(ics).toMatch(/\r\nDTSTART:\d{8}T013000Z\r\n/);
    expect(ics).toContain("SUMMARY:see you at/effect\r\n");
    expect(ics).toContain(`URL:${origin}/${slugs.upcoming}\r\n`);
    // The same record gives the same file.
    expect((await get(Events, `/${slugs.upcoming}/calendar.ics`)).html).toBe(
      ics,
    );
  });

  it("lists who is on stage, with what they do and where to find them", async ({
    Events,
  }) => {
    const { html } = await page(Events, slugs.upcoming);
    const stage = row(html, "On stage");
    expect(stage).toContain(
      '<section class="stage-talk"><p class="at-type-meta">fireside chat</p><h2 class="stage-title at-type-lead">A fireside chat on Effect</h2>',
    );
    // Grace moderates; Ada is the fireside's guest.
    expect(stage).toContain(
      '<p class="speaker-role at-type-meta">moderator</p><h3 class="at-type-list-name"><a href="/people#p-b0000000-0000-4000-8000-000000000502">Grace Hopper</a></h3>',
    );
    expect(stage).toContain(
      '<p class="speaker-role at-type-meta">guest</p><h3 class="at-type-list-name"><a href="/people#p-b0000000-0000-4000-8000-000000000501">Ada Lovelace</a></h3>',
    );
    expect(stage).toContain(
      '<div class="stage-description"><p>Typed errors &amp; <strong>services</strong>.</p></div>',
    );
    expect(stage).not.toContain("<script");
    expect(stage).toContain(`<img src="${speakerPortrait}" alt=""`);
    expect(stage).toContain(
      '<h3 class="at-type-list-name"><a href="/people#p-b0000000-0000-4000-8000-000000000501">Ada Lovelace</a></h3>',
    );
    expect(stage).toContain(
      '<p class="speaker-title">Engineer, Analytical Engines</p>',
    );
    expect(stage).toContain(
      '<a href="https://twitter.com/@ada"><span>@ada</span><span class="visually-hidden">, Ada Lovelace on X</span></a>',
    );
    expect(stage).toContain(
      '<p class="speaker-bio">Writes the first programs.</p>',
    );
  });

  it("names its organizers as your hosts beside the hosting company, then its co-hosts", async ({
    Events,
  }) => {
    const { html } = await page(Events, slugs.upcoming);
    const hosted = row(html, "Hosted at");
    // Andre is first in this evening's order, and has no photo.
    expect(hosted).toMatch(
      new RegExp(
        `<span class="host-portraits"><img src="/assets/avatar\\.[0-9a-f]{16}\\.svg" alt="" width="44" height="44" loading="lazy" decoding="async"/><img src="${erikPortrait}"`,
      ),
    );
    expect(hosted).toContain(
      '<span class="host-names">Andre &amp; Erik</span>',
    );
    expect(hosted).toContain('<p class="at-type-meta">co-hosts</p>');
    expect(
      [
        ...hosted.matchAll(
          /<a class="event-person-name" href="[^"]+"><span>([^<]+)</g,
        ),
      ].map(([, name]) => name),
    ).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(hosted).toContain(
      '<a class="event-person-name" href="/people#p-b0000000-0000-4000-8000-000000000501"><span>Ada Lovelace</span></a><span class="event-person-title">Engineer, Analytical Engines</span>',
    );
    expect(hosted).not.toContain(">mc<");
    // The footer still signs off with Erik and Andre.
    expect(html).toContain(
      '<p><a href="/about">hosted by Erik &amp; Andre</a></p>',
    );
  });

  it("describes itself as a schema.org Event in its head", async ({
    Events,
  }) => {
    const { html } = await page(Events, slugs.upcoming);
    const json = /<script type="application\/ld\+json">([^<]*)<\/script>/.exec(
      html,
    )?.[1];
    expect(JSON.parse(json ?? "null")).toMatchObject({
      "@type": "Event",
      name: "Effect San Francisco",
      url: `${origin}/${slugs.upcoming}`,
      offers: { url: lumaPage },
    });
    expect(html).toContain(
      `<link rel="canonical" href="${origin}/${slugs.upcoming}"/>`,
    );
  });
});

describe("a morning without a venue or a Luma page", () => {
  it("follows the system though it is a daytime event, and leaves out the rows it has nothing for", async ({
    Events,
  }) => {
    const { html } = await page(Events, slugs.bare);
    expect(html).toStartWith('<!doctype html><html lang="en"><head>');
    expect(labels(html)).toEqual(["When", "Hosted by"]);
    expect(html).not.toContain("google.com/maps");
  });
});

describe("a live evening", () => {
  it("keeps the cursor and I'm in, and says it is on now", async ({
    Events,
  }) => {
    const { html } = await page(Events, slugs.live);
    expect(html).toContain(
      '<span>live</span><span class="at-cursor" aria-hidden="true">_</span></h1>',
    );
    expect(row(html, "When")).toContain("San Francisco time. On now.</p>");
    expect(row(html, "Seats")).toContain('href="https://lu.ma/event/evt-live"');
    // Neither its seats nor its guests are known.
    expect(row(html, "Seats")).not.toContain("<p>");
    expect(row(html, "Where")).toContain(
      '<p class="fact-head place">Potrero Hill</p><p class="venue">Convex HQ</p>',
    );
  });
});

describe("a past evening", () => {
  it("loses the cursor and becomes its recording, photos, and what comes next", async ({
    Events,
  }) => {
    const { html } = await page(Events, slugs.past);
    expect(html).toContain(
      '<h1 class="event-name event-name-l">all things<span class="slash">/</span><wbr/><span>web</span></h1>',
    );
    expect(labels(html)).toEqual([
      "When",
      "Where",
      "Hosted at",
      "Recording",
      "On stage",
      "Photos",
      "Posts",
      "Next",
    ]);
    expect(html).not.toContain("I’m in");
    expect(html).not.toContain("calendar.ics");
    expect(row(html, "Recording")).toContain(
      '<a class="button" href="https://youtu.be/sanity">Watch<span class="visually-hidden"> the recording</span><span aria-hidden="true">→</span></a>',
    );
    expect(row(html, "Hosted at")).toContain(
      '<p class="fact-head">Sanity &amp; Clerk</p>',
    );
    expect(row(html, "Hosted at")).toContain(
      '<p class="at-type-meta">mc</p><ul><li class="event-person">',
    );
    expect(row(html, "When")).toContain("<p>146 went.</p>");
  });

  it("lists every speaker of a talk two people gave", async ({ Events }) => {
    const { html } = await page(Events, slugs.past);
    const stage = row(html, "On stage");
    expect(
      [
        ...stage.matchAll(
          /<h3 class="at-type-list-name"><a href="[^"]+">([^<]+)</g,
        ),
      ].map(([, name]) => name),
    ).toEqual(["Grace Hopper", "Ada Lovelace"]);
    // Grace has no photo, title, bio or links: the blank avatar, and only her name.
    expect(stage).toMatch(
      /<article class="speaker"><img src="\/assets\/avatar\.[0-9a-f]{16}\.svg" alt="" width="168" height="168" loading="lazy" decoding="async"\/><div class="speaker-who"><h3 class="at-type-list-name"><a href="\/people#p-b0000000-0000-4000-8000-000000000502">Grace Hopper<\/a><\/h3><\/div><\/article>/,
    );
    expect(stage).not.toContain("stage-description");
  });

  it("shows its photos on the media origin, sized and lazy", async ({
    Events,
  }) => {
    const { html } = await page(Events, slugs.past);
    const photos = row(html, "Photos");
    expect(photos).toContain(
      `<img src="${eventPhoto("crowd")}" alt="The crowd at Sanity" width="1600" height="1200" loading="lazy" decoding="async"/>`,
    );
    expect(photos).toContain(
      `<img src="${eventPhoto("stage")}" alt="Ada on stage" width="1200" height="1600"`,
    );
    expect(photos).not.toContain("elsewhere.example");
  });

  it("lists its approved posts, earliest first, with their photos on the media origin", async ({
    Events,
  }) => {
    const { html } = await page(Events, slugs.past);
    const posts = row(html, "Posts");
    expect(
      [...posts.matchAll(/<p class="post-text">([^<]+)<\/p>/g)].map(
        ([, text]) => text,
      ),
    ).toEqual(["Compilers, together, at Sanity.", "Thanks, Sanity!"]);
    expect(posts).toContain(
      `<img src="${eventPhoto("stage")}" alt="Ada on stage" width="1200" height="1600" loading="lazy" decoding="async"/>`,
    );
    expect(posts).toContain(
      `<li class="post"><img src="${speakerPortrait}" alt="" width="36" height="36" loading="lazy" decoding="async"/>`,
    );
    expect(posts).toContain(
      '<a href="https://x.com/i/status/1884000000000000001"><time datetime="2025-01-29T02:30:00.000Z">Tue Jan 28</time><span> on X</span><span aria-hidden="true"> →</span></a>',
    );
    expect(posts).not.toContain("Hidden by an organizer.");
    expect(posts).not.toContain("Found by a search.");
    expect(posts).not.toContain("more on X");
  });

  it("points to the live evening as next", async ({ Events }) => {
    const { html } = await page(Events, slugs.past);
    expect(row(html, "Next")).toContain(
      `<a href="/${slugs.live}">at<span class="slash">/</span><span>live</span><span class="at-cursor" aria-hidden="true">_</span></a>`,
    );
    expect(row(html, "Next")).toContain(">Now · Potrero Hill</time>");
  });
});

describe("a past daytime hackathon", () => {
  it("follows the system, under the topic the site set, hosted by Erik and Andre alone", async ({
    Events,
  }) => {
    const { html } = await page(Events, slugs.hackathon);
    expect(html).toStartWith('<!doctype html><html lang="en"><head>');
    expect(html).toContain("<title>all things/web hackathon</title>");
    expect(html).toContain('class="event-name event-name-m"');
    expect(labels(html)).toEqual([
      "When",
      "Where",
      "Hosted by",
      "Schedule",
      "Awards",
      "Theme",
      "Next",
    ]);
    expect(row(html, "When")).toContain(
      "<p>10:30 AM–8:30 PM, San Francisco time</p>",
    );
    expect(row(html, "Where")).toContain('<p class="fact-head place">FiDi</p>');
  });

  it("shows its schedule and its notes as the database has them", async ({
    Events,
  }) => {
    const { html } = await page(Events, slugs.hackathon);
    expect(row(html, "Schedule")).toContain(
      '<li><span class="schedule-time at-type-meta">10:30 am</span><div class="schedule-step"><p class="schedule-title">Doors open</p><p class="schedule-description">Get to know your fellow hackers and form teams.</p></div></li><li><span class="schedule-time at-type-meta">1 - 7:30 pm</span><div class="schedule-step"><p class="schedule-title">Hacking time</p></div></li>',
    );
    expect(row(html, "Awards")).toContain(
      '<div class="note"><p>Two awards: the most <strong>creative</strong> and the most impactful.</p></div>',
    );
    expect(row(html, "Theme")).toContain(
      '<div class="note"><p>Future of Web</p></div>',
    );
  });
});

describe("the mode", () => {
  it("is the visitor's when they fixed one, cached only by their browser", async ({
    Events,
  }) => {
    const { response, html } = await page(Events, slugs.upcoming, {
      headers: { cookie: "theme=light" },
    });
    expect(html).toStartWith(
      '<!doctype html><html lang="en" data-theme="light">',
    );
    expect(html).toContain(
      '<button type="button" popovertarget="mode-choices" aria-label="mode: paper">',
    );
    expect(html).toMatch(
      /<a href="\?theme=light" rel="nofollow" aria-current="true"><svg[^]*?<\/svg><span>paper<\/span><\/a>/,
    );
    expect(response.headers.get("cache-control")).toBe(
      PrivateCacheControl.publicData,
    );
  });

  it("follows the system until the visitor chooses, on an evening's page as on any", async ({
    Events,
  }) => {
    const { html } = await page(Events, slugs.upcoming);
    expect(html).toStartWith('<!doctype html><html lang="en"><head>');
    expect(html).toContain(
      '<button type="button" popovertarget="mode-choices" aria-label="mode: system">',
    );
    expect(html).toMatch(
      /<a href="\?theme=system" rel="nofollow" aria-current="true"><svg[^]*?<\/svg><span>system<\/span><\/a>/,
    );
  });

  it("is chosen on the page and sends the visitor back to it", async ({
    Events,
  }) => {
    const response = await fetch(
      `${Events}/${encodeURIComponent("2025-01-28-all-things-web-at-sanity")}?theme=dark`,
      { redirect: "manual" },
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/${slugs.past}`);
    expect(response.headers.get("cache-control")).toBe(preferenceCacheControl);
    expect(response.headers.get("set-cookie")).toStartWith("theme=dark;");
    await response.arrayBuffer();
  });
});

describe("what isn't published", () => {
  for (const slug of [slugs.draft, "no-such-evening"]) {
    it(`answers ${slug} with the branded not-found page, briefly cached`, async ({
      Events,
    }) => {
      const { response, html } = await page(Events, slug);
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe(CacheControl.notFound);
      expect(html).toContain('<p class="at-type-meta">404 · not found</p>');
      expect(html).toContain(
        '<p class="lead at-type-lead">No evening lives at this address.</p>',
      );
      expect(html).not.toContain("All Things Draft");
      expect(html).toContain(`<img src="${erikPortrait}"`);
      const ics = await get(
        Events,
        `/${encodeURIComponent(slug)}/calendar.ics`,
      );
      expect(ics.response.status).toBe(404);
      expect(ics.html).not.toContain("BEGIN:VCALENDAR");
    });
  }
});

describe("without a database", () => {
  it("says the evening didn't load, and is never stored", async ({
    Unreachable,
  }) => {
    const { response, html } = await page(Unreachable, slugs.upcoming);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe(CacheControl.failure);
    expect(html).toContain("This evening didn’t load.");
    const ics = await get(Unreachable, `/${slugs.upcoming}/calendar.ics`);
    expect(ics.response.status).toBe(503);
    expect(ics.response.headers.get("cache-control")).toBe(
      CacheControl.failure,
    );
    const short = await get(Unreachable, "/r/discord", { redirect: "manual" });
    expect(short.response.status).toBe(500);
    expect(short.response.headers.get("cache-control")).toBe(
      CacheControl.failure,
    );
  });
});

describe("short links", () => {
  it("redirect /r/<slug> to the stored destination, as the app does", async ({
    Events,
  }) => {
    const response = await fetch(`${Events}/r/discord`, { redirect: "manual" });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(redirects.discord);
    await response.arrayBuffer();
  });

  for (const slug of ["Discord", "nothing", "unsafe"]) {
    it(`answer /r/${slug} with 404`, async ({ Events }) => {
      const { response, html } = await get(Events, `/r/${slug}`, {
        redirect: "manual",
      });
      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cache-control")).toBe(CacheControl.notFound);
      expect(html).toBe("Redirect not found");
    });
  }
});
