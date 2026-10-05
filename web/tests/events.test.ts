import { describe, expect } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { CacheControl, PrivateCacheControl } from "../src/cache.ts";
import { discord, lumaCalendar } from "../src/links.ts";
import { contentSecurityPolicy } from "../src/pages/response.ts";
import { catalogDatabase, erikPortrait, past } from "./support/catalog.ts";
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
 * The evenings index, served by the Worker in workerd, reading PGlite over
 * TCP as it will read Hyperdrive: the home page's catalogs, written
 * relative to now, with evenings announced and without.
 */

const origin = "https://allthings.dev";
const startedAt = new Date();

const announced = await serve(await catalogDatabase(startedAt, true));
const quiet = await serve(await catalogDatabase(startedAt, false));

const Stack = testStack("allthings-web-events-test", {
  Announced: { ORIGIN: origin, DATABASE_URL: announced.url },
  Quiet: { ORIGIN: origin, DATABASE_URL: quiet.url },
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
      Effect.promise(() => Promise.all([announced.stop(), quiet.stop()])),
    ),
  ),
);

type Worker = "Announced" | "Quiet" | "Unreachable";

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
          Unreachable: url("Unreachable"),
        });
      }),
    ),
  );

/** /events fetched with `init`, and its HTML. */
const events = async (url: string, init?: RequestInit) => {
  const response = await fetch(`${url}/events`, init);
  return { response, html: await response.text() };
};

/** The list section headed `id`, or "" when the page has none. */
function section(html: string, id: string): string {
  const start = html.indexOf(`aria-labelledby="${id}"`);
  return start === -1
    ? ""
    : html.slice(start, html.indexOf("</section>", start));
}

const rows = (html: string) =>
  [...html.matchAll(/<li>[\s\S]*?<\/li>/g)].map(([row]) => row);

/** The slugs the rows of `html` link to, in order. */
const linked = (html: string) =>
  rows(html).map(
    (row) =>
      /<a class="row" href="([^"]+)"/
        .exec(row)?.[1]
        // Rows link within the site, root-relative.
        ?.replace(/^\//, "") ?? "",
  );

describe("/events", () => {
  it("answers with HTML cached like public data", async ({ Announced }) => {
    const { response } = await events(Announced);
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

  it("lists the evenings ahead first, soonest first, with the cursor", async ({
    Announced,
  }) => {
    const { html } = await events(Announced);
    const upcoming = section(html, "upcoming");
    expect(upcoming).toContain(">Upcoming</h2>");
    expect(linked(upcoming)).toEqual([
      "next-effect-sf",
      "then-js-trivia-night",
      "later-typescript-ai-after-party",
    ]);
    for (const row of rows(upcoming)) expect(row).toContain("at-cursor");
    expect(rows(upcoming)[0]).toContain(
      'at<span class="slash">/</span><span>effect</span><span class="at-cursor" aria-hidden="true">_</span>',
    );
    expect(rows(upcoming)[0]).toContain(">East Cut</span>");
  });

  it("lists every evening that has ended, latest first, under its year in San Francisco", async ({
    Announced,
  }) => {
    const { html } = await events(Announced);
    expect(
      [...html.matchAll(/<h2 id="([^"]+)"[^>]*>([^<]*)<\/h2>/g)].map(
        ([, id, title]) => [id, title],
      ),
    ).toEqual([
      ["upcoming", "Upcoming"],
      ["evenings-2026", "2026"],
      ["evenings-2025", "2025"],
    ]);
    const y2026 = section(html, "evenings-2026");
    const y2025 = section(html, "evenings-2025");
    expect([...linked(y2026), ...linked(y2025)]).toEqual(
      past.map((evening) => evening.slug),
    );
    [...rows(y2026), ...rows(y2025)].forEach((row, index) => {
      expect(row).toContain(`>${past[index]?.listDate}</time>`);
      expect(row).not.toContain("at-cursor");
    });
    // Its name yields no topic; the site set one.
    expect(rows(y2025)[0]).toContain(
      'at<span class="slash">/</span><span>ship ai</span>',
    );
  });

  it("never shows a draft", async ({ Announced }) => {
    const { html } = await events(Announced);
    expect(html).not.toContain("draft");
    expect(html).not.toContain("Draft");
  });

  it("offers Luma and Discord as actions", async ({ Announced }) => {
    const { html } = await events(Announced);
    expect(html).toContain(`<a href="${lumaCalendar}">subscribe on luma</a>`);
    expect(html).toContain(
      `<a href="${discord}">talk between evenings <span aria-hidden="true">→</span> discord</a>`,
    );
  });

  it("leaves out Upcoming when nothing is announced, and still lists the rest", async ({
    Quiet,
  }) => {
    const { response, html } = await events(Quiet);
    expect(response.status).toBe(200);
    expect(html).not.toContain("Upcoming");
    expect(html.match(/<a class="row"/g)).toHaveLength(past.length);
  });

  it("signs off with the hosts' portraits", async ({ Announced }) => {
    const { html } = await events(Announced);
    expect(html).toContain(
      '<p><a href="/about">hosted by Erik &amp; Andre</a></p>',
    );
    expect(html).toContain(`<img src="${erikPortrait}"`);
  });

  for (const worker of ["Announced", "Quiet"] as const) {
    it(`is valid HTML, with one header, main, footer and h1, and headings in order (${worker})`, async (urls) => {
      const { html } = await events(urls[worker]);
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
    });

    it(`gzips to at most ${htmlBudget} bytes of HTML and ${cssBudget} of CSS, and runs no JavaScript (${worker})`, async (urls) => {
      const { html } = await events(urls[worker]);
      const css = await (
        await fetch(`${urls[worker]}${stylesheetOf(html)}`)
      ).text();
      expect(gzipped(html)).toBeLessThanOrEqual(htmlBudget);
      expect(gzipped(css)).toBeLessThanOrEqual(cssBudget);
      expect(html).not.toMatch(/<script|\son[a-z]+=|javascript:/i);
      for (const path of [...subresources(html), ...stylesheetUrls(css)]) {
        if (path !== erikPortrait) expect(path).toMatch(/^\/(?!\/)/);
      }
    });
  }

  it("says plainly when the evenings can't be read, and is never cached", async ({
    Unreachable,
  }) => {
    const { response, html } = await events(Unreachable);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe(CacheControl.failure);
    expect(html).toContain("The evenings didn’t load. Try again in a minute.");
    expect(await htmlProblems(html)).toEqual([]);
  });
});

describe("/events in a mode", () => {
  it("remembers ?theme=dark and comes back to /events", async ({
    Announced,
  }) => {
    const response = await fetch(`${Announced}/events?theme=dark`, {
      redirect: "manual",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/events");
    expect(response.headers.get("set-cookie")).toStartWith("theme=dark;");
    await response.arrayBuffer();
  });

  for (const theme of ["light", "dark"] as const) {
    it(`renders ${theme} for that visitor's browser alone, within budget`, async ({
      Announced,
    }) => {
      const { response, html } = await events(Announced, {
        headers: { cookie: `theme=${theme}` },
      });
      expect(html).toStartWith(
        `<!doctype html><html lang="en" data-theme="${theme}">`,
      );
      expect(response.headers.get("cache-control")).toBe(
        PrivateCacheControl.publicData,
      );
      expect(gzipped(html)).toBeLessThanOrEqual(htmlBudget);
    });
  }
});

describe("/'s every evening", () => {
  it("goes to /events", async ({ Announced }) => {
    const html = await (await fetch(`${Announced}/`)).text();
    expect(html).toContain('<a href="/events">every evening');
  });
});
