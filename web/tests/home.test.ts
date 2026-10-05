import { describe, expect } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { CacheControl, PrivateCacheControl } from "../src/cache.ts";
import { mediaOrigin } from "../src/links.ts";
import { contentSecurityPolicy } from "../src/pages/response.ts";
import {
  catalogDatabase,
  erikPortrait,
  mediaPhoto,
  past,
} from "./support/catalog.ts";
import {
  cssBudget,
  gzipped,
  headingLevels,
  htmlBudget,
  htmlProblems,
  stylesheetOf,
  stylesheetUrls,
  subresources,
  withoutStructuredData,
} from "./support/pages.ts";
import { serve } from "./support/socket.ts";
import { testStack } from "./support/stack.ts";

/**
 * The home page, served by the Worker in workerd, reading PGlite over TCP
 * as it will read Hyperdrive. Two catalogs, written relative to now: one
 * with evenings announced, one without (as production is today). A third
 * has lost its profiles, so only the hosts' portraits fail to read.
 */

const origin = "https://allthings.dev";
const startedAt = new Date();

const announced = await serve(await catalogDatabase(startedAt, true));
const quiet = await serve(await catalogDatabase(startedAt, false));
const withoutProfiles = await catalogDatabase(startedAt, true);
await withoutProfiles.exec("DROP TABLE profiles CASCADE");
const noProfiles = await serve(withoutProfiles);

const Stack = testStack("allthings-web-home-test", {
  Announced: { ORIGIN: origin, DATABASE_URL: announced.url },
  Quiet: { ORIGIN: origin, DATABASE_URL: quiet.url },
  NoProfiles: { ORIGIN: origin, DATABASE_URL: noProfiles.url },
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
  destroy(Stack).pipe(
    Effect.ensuring(
      Effect.promise(() =>
        Promise.all([announced.stop(), quiet.stop(), noProfiles.stop()]),
      ),
    ),
  ),
);

type Worker = "Announced" | "Quiet" | "NoProfiles" | "Unreachable";

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
          Announced: url("Announced"),
          Quiet: url("Quiet"),
          NoProfiles: url("NoProfiles"),
          Unreachable: url("Unreachable"),
        });
      }),
    ),
  );

/** / fetched with `init`, and its HTML. */
const home = async (url: string, init?: RequestInit) => {
  const response = await fetch(`${url}/`, init);
  return { response, html: await response.text() };
};

/** The text of the element `pattern` matches, its tags dropped. */
const text = (html: string, pattern: RegExp) =>
  (pattern.exec(html)?.[1] ?? "").replace(/<[^>]+>/g, "").trim();

/** The list section headed `id`, or "" when the page has none. */
function section(html: string, id: string): string {
  const start = html.indexOf(`aria-labelledby="${id}"`);
  return start === -1
    ? ""
    : html.slice(start, html.indexOf("</section>", start));
}

/** The photo mosaic beside the hero, or "" when the page has none. */
function mosaic(html: string): string {
  const start = html.indexOf('<div class="mosaic');
  return start === -1 ? "" : html.slice(start, html.indexOf("</div>", start));
}

/** The footer's portraits. */
const portraits = (html: string) =>
  /<span class="portraits">(.*?)<\/span>/
    .exec(html)?.[1]
    ?.match(/<img [^>]*>/g) ?? [];

/** San Francisco's wall clock, as an oracle independent of the Worker's code. */
const inSanFrancisco = (date: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    ...options,
  })
    .format(date)
    .replaceAll("\u202f", " ");

describe("/ with evenings announced", () => {
  it("answers with HTML cached like public data", async ({ Announced }) => {
    const { response } = await home(Announced);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(CacheControl.publicData);
    expect(response.headers.get("content-security-policy")).toBe(
      contentSecurityPolicy.originals,
    );
    expect(response.headers.get("vary")).toBe("accept-encoding, cookie");
  });

  it("leads with the next evening: when, the lockup, where, who hosts, and I'm in", async ({
    Announced,
  }) => {
    const { html } = await home(Announced);
    const start = new Date(startedAt.getTime() + 7 * 24 * 3_600_000);
    const day = inSanFrancisco(start, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).replace(",", "");
    const time = inSanFrancisco(start, { hour: "numeric", minute: "2-digit" });
    expect(text(html, /<time datetime="[^"]+">(Next · [^<]*)<\/time>/)).toBe(
      `Next · ${day} · ${time}`,
    );
    expect(html).toContain(
      '<h1 id="next" class="hero-name lockup-l">all things<span class="slash">/</span><br/><span>effect</span><span class="at-cursor" aria-hidden="true">_</span></h1>',
    );
    expect(html).toContain('<p class="hero-label">East Cut · CodeRabbit</p>');
    expect(html).toContain(
      '<a class="button" href="https://lu.ma/event/evt-next">I’m in<span class="visually-hidden">, on Luma</span><span aria-hidden="true">→</span></a>',
    );
    // "see you at/effect" belongs after the click, never beside the button.
    expect(html).not.toContain("see you");
  });

  it("says the next evening once: it is in no list below", async ({
    Announced,
  }) => {
    const { html } = await home(Announced);
    expect(html).not.toContain("next-effect-sf");
    expect(section(html, "after-that")).not.toContain("effect");
  });

  it("lists the evenings after that, soonest first, with the cursor", async ({
    Announced,
  }) => {
    const { html } = await home(Announced);
    const after = section(html, "after-that");
    expect(after).toContain(">After that</h2>");
    const rows = [...after.matchAll(/<li>[\s\S]*?<\/li>/g)].map(([row]) => row);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain(`href="/then-js-trivia-night"`);
    expect(rows[0]).toContain(
      'at<span class="slash">/</span><span>js trivia night</span><span class="at-cursor" aria-hidden="true">_</span>',
    );
    expect(rows[0]).toContain(">Dogpatch</span>");
    // A name that isn't a topic is shown as written, without the slash.
    expect(rows[1]).toContain(
      "<span>TypeScript AI: The official conference after-party</span>",
    );
    expect(rows[1]).toContain(">Mission</span>");
  });

  it("lists the latest three evenings that have ended, in San Francisco dates, without the cursor", async ({
    Announced,
  }) => {
    const { html } = await home(Announced);
    const recently = section(html, "recently");
    const rows = [...recently.matchAll(/<li>[\s\S]*?<\/li>/g)].map(
      ([row]) => row,
    );
    expect(rows).toHaveLength(3);
    past.slice(0, 3).forEach((evening, index) => {
      const row = rows[index] ?? "";
      expect(row).toContain(`href="/${evening.slug}"`);
      expect(text(row, /<time[^>]*>([^<]*)<\/time>/)).toBe(evening.listDate);
      expect(row).toContain(`datetime="${evening.start.toISOString()}"`);
      expect(row).not.toContain("at-cursor");
    });
    expect(rows[0]).toContain(
      'at<span class="slash">/</span><span>effect</span>',
    );
    expect(rows[0]).toContain(">East Cut</span>");
    // Its name yields no topic; the site set one.
    expect(rows[1]).toContain(
      'at<span class="slash">/</span><span>ship ai</span>',
    );
    expect(rows[1]).not.toContain("Pre Next.js Conf");
    expect(rows[2]).toContain("<span>react bay area</span>");
    expect(rows[2]).toContain(">FiDi</span>");
    expect(recently).not.toContain(past[3].slug);
    expect(recently).toContain('<a href="/events">every evening');
    expect(recently).toContain(
      '<a href="https://luma.com/allthingsweb">subscribe on luma</a>',
    );
  });

  it("never shows a draft", async ({ Announced }) => {
    const { html } = await home(Announced);
    expect(html).not.toContain("draft");
    expect(html).not.toContain("Draft");
  });

  it("sets three community photos beside the hero, from the media origin, sized", async ({
    Announced,
  }) => {
    const { html } = await home(Announced);
    const images = mosaic(html).match(/<img [^>]*>/g) ?? [];
    expect(images).toEqual([
      `<img src="${mediaPhoto("effect")}" alt="Michael Arnaldi on stage at CodeRabbit" width="1600" height="1200" loading="lazy" decoding="async"/>`,
      `<img src="${mediaPhoto("pier-70")}" alt="The crowd at Pier 70" width="1200" height="900" loading="lazy" decoding="async"/>`,
      `<img src="${mediaPhoto("mux")}" alt="Pizza at Mux" width="1024" height="768" loading="lazy" decoding="async"/>`,
    ]);
    expect(html).toContain('<div class="mosaic tiles-3">');
  });
});

describe("/ with nothing announced", () => {
  it("leaves the slot open and asks people to subscribe", async ({ Quiet }) => {
    const { response, html } = await home(Quiet);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(CacheControl.publicData);
    expect(html).toContain('<p class="at-type-meta">Next · soon</p>');
    expect(html).toContain(
      '<h1 id="next" class="hero-name lockup-l">all things<span class="slash">/</span><br/><span class="at-cursor" aria-hidden="true">_</span></h1>',
    );
    expect(html).toContain(
      '<a class="button" href="https://luma.com/allthingsweb">Subscribe on Luma <span aria-hidden="true">→</span></a>',
    );
    expect(html).not.toContain("I’m in");
  });

  it("hides After that, and says subscribe only once", async ({ Quiet }) => {
    const { html } = await home(Quiet);
    expect(html).not.toContain("After that");
    expect(html).not.toContain("subscribe on luma");
    expect(
      html.match(/href="https:\/\/luma\.com\/allthingsweb"/g),
    ).toHaveLength(
      // The hero's button and the footer's luma.
      2,
    );
  });

  it("still lists the latest three evenings and shows the photos", async ({
    Quiet,
  }) => {
    const { html } = await home(Quiet);
    const rows = section(html, "recently").match(/<li>/g) ?? [];
    expect(rows).toHaveLength(3);
    expect(mosaic(html).match(/<img /g)).toHaveLength(3);
  });
});

describe("/ as a page", () => {
  for (const worker of ["Announced", "Quiet"] as const) {
    it(`is valid HTML, with one header, main and footer, and headings in order (${worker})`, async (urls) => {
      const { html } = await home(urls[worker]);
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
      // Every photo says what it shows.
      for (const image of html.match(/<img [^>]*>/g) ?? []) {
        expect(image).toMatch(/ alt="[^"]*"/);
      }
    });

    it(`loads only this site's files and the media origin's photos, and runs no JavaScript (${worker})`, async (urls) => {
      const { html } = await home(urls[worker]);
      const css = await (
        await fetch(`${urls[worker]}${stylesheetOf(html)}`)
      ).text();
      const loaded = [...subresources(html), ...stylesheetUrls(css)];
      const photos = html.match(/<img src="https:[^"]*"/g) ?? [];
      expect(photos.length).toBeGreaterThan(0);
      for (const path of loaded) {
        if (path.startsWith("https:")) {
          expect(new URL(path).origin).toBe(mediaOrigin);
          expect(photos).toContain(`<img src="${path}"`);
        } else {
          expect(path).toMatch(/^\/(?!\/)/);
        }
      }
      // Its one script element is the JSON-LD data block, which never runs.
      expect(html).toContain('<script type="application/ld+json">');
      expect(withoutStructuredData(html)).not.toMatch(
        /<script|\son[a-z]+=|javascript:/i,
      );
    });

    it(`gzips to at most ${htmlBudget} bytes of HTML and ${cssBudget} of CSS (${worker})`, async (urls) => {
      const { html } = await home(urls[worker]);
      const css = await (
        await fetch(`${urls[worker]}${stylesheetOf(html)}`)
      ).text();
      expect(gzipped(html)).toBeLessThanOrEqual(htmlBudget);
      expect(gzipped(css)).toBeLessThanOrEqual(cssBudget);
    });
  }

  it("is sent compressed to clients that accept it", async ({ Announced }) => {
    const response = await fetch(`${Announced}/`, {
      headers: { "accept-encoding": "br, gzip" },
      decompress: false,
    });
    expect(response.headers.get("content-encoding")).toBe("br");
    await response.arrayBuffer();
  });

  it("says plainly when the evenings can't be read, and is never cached", async ({
    Unreachable,
  }) => {
    const { response, html } = await home(Unreachable);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe(CacheControl.failure);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(html).toContain("The evenings didn’t load. Try again in a minute.");
    expect(await htmlProblems(html)).toEqual([]);
  });
});

const blankAvatar = /^<img src="\/assets\/avatar\.[0-9a-f]{16}\.svg" alt=""/;

describe("/'s footer", () => {
  it("signs off with the portrait from each host's profile, by id, and the blank avatar where there is none", async ({
    Announced,
  }) => {
    const { response, html } = await home(Announced);
    expect(response.headers.get("cache-control")).toBe(CacheControl.publicData);
    expect(html).toContain(
      '<p><a href="/about">hosted by Erik &amp; Andre</a></p>',
    );
    const [erik, andre, ...more] = portraits(html);
    expect(erik).toBe(
      `<img src="${erikPortrait}" alt="" width="36" height="36" loading="lazy" decoding="async" fetchpriority="low"/>`,
    );
    expect(andre).toMatch(blankAvatar);
    expect(more).toEqual([]);
    // Another profile is named Andre Landgraf and has a photo.
    expect(html).not.toContain("not-andre");
  });

  it("shows the blank avatars, and is never stored, when only the portraits can't be read", async ({
    NoProfiles,
  }) => {
    const { response, html } = await home(NoProfiles);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(CacheControl.failure);
    expect(html).toContain('<h1 id="next" class="hero-name lockup-l">');
    const images = portraits(html);
    expect(images).toHaveLength(2);
    for (const image of images) expect(image).toMatch(blankAvatar);
  });

  it("shows the blank avatars when nothing can be read", async ({
    Unreachable,
  }) => {
    const { html } = await home(Unreachable);
    const images = portraits(html);
    expect(images).toHaveLength(2);
    for (const image of images) expect(image).toMatch(blankAvatar);
  });
});

describe("/ in a mode", () => {
  it("remembers ?theme=dark and comes back to /", async ({ Announced }) => {
    const response = await fetch(`${Announced}/?theme=dark`, {
      redirect: "manual",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toStartWith("theme=dark;");
    await response.arrayBuffer();
  });

  it("renders the mode its cookie fixes, for that visitor's browser alone", async ({
    Announced,
  }) => {
    const { response, html } = await home(Announced, {
      headers: { cookie: "theme=dark" },
    });
    expect(html).toStartWith(
      '<!doctype html><html lang="en" data-theme="dark">',
    );
    expect(response.headers.get("cache-control")).toBe(
      PrivateCacheControl.publicData,
    );
    expect(response.headers.get("vary")).toBe("accept-encoding, cookie");
  });

  it("keeps the mode when the evenings can't be read", async ({
    Unreachable,
  }) => {
    const { response, html } = await home(Unreachable, {
      headers: { cookie: "theme=light" },
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe(CacheControl.failure);
    expect(html).toStartWith(
      '<!doctype html><html lang="en" data-theme="light">',
    );
  });
});
