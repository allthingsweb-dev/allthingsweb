import { describe, expect } from "bun:test";
import { readdir } from "node:fs/promises";
import { apcaContrast, wcagContrast } from "allthings-brand/src/contrast.ts";
import {
  colors,
  contrastRequirements,
  tokens,
} from "allthings-brand/src/tokens.ts";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { immutable } from "../scripts/build.ts";
import {
  CacheControl,
  PrivateCacheControl,
  preferenceCacheControl,
} from "../src/cache.ts";
import { hosts, mediaOrigin, socials } from "../src/links.ts";
import { contentSecurityPolicy } from "../src/pages/response.ts";
import { themeCookieMaxAge } from "../src/pages/theme.ts";
import { erikPortrait } from "./support/catalog.ts";
import { eventDatabase, slugs } from "./support/event-catalog.ts";
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
import { budgetProblems } from "./support/bundle.ts";
import { bundleBudgets, testStack } from "./support/stack.ts";

/**
 * The site's pages, served by the Worker in workerd with its static assets,
 * as they deploy. /brand reads only the hosts' portraits; without a
 * database, the blank avatars stand in. Event pages read the evenings of
 * support/event-catalog.ts, which holds the hosts' profiles too.
 */

const database = await serve(await eventDatabase(new Date()));

const Stack = testStack("allthings-web-pages-test", {
  Pages: { ORIGIN: "https://allthings.dev", DATABASE_URL: database.url },
  NoDatabase: { ORIGIN: "https://allthings.dev" },
});

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});
const workers = beforeAll(deploy(Stack));
afterAll(
  destroy(Stack).pipe(Effect.ensuring(Effect.promise(() => database.stop()))),
);

/**
 * A test that gets the running Worker's URL, and that of the one without
 * a database.
 */
const it = (
  name: string,
  run: (url: string, noDatabase: string) => Promise<void>,
) =>
  test(
    name,
    Effect.flatMap(workers, (outputs) =>
      Effect.promise(() => {
        const url = (worker: "Pages" | "NoDatabase") => {
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
        return run(url("Pages"), url("NoDatabase"));
      }),
    ),
  );

/** /brand with `query`, fetched with `init`, and its HTML. */
const brand = async (url: string, query = "", init?: RequestInit) => {
  const response = await fetch(`${url}/brand${query}`, init);
  return { response, html: await response.text() };
};

/** The footer's portraits. */
const portraits = (html: string) =>
  /<span class="portraits">(.*?)<\/span>/
    .exec(html)?.[1]
    ?.match(/<img [^>]*>/g) ?? [];

const blankAvatar = /^<img src="\/assets\/avatar\.[0-9a-f]{16}\.svg" alt=""/;

describe("/brand", () => {
  it("answers with HTML that caches and may load only this site's files", async (url) => {
    const { response } = await brand(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(CacheControl.page);
    expect(response.headers.get("content-security-policy")).toBe(
      contentSecurityPolicy.originals,
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("vary")).toBe("accept-encoding, cookie");
  });

  for (const [accepted, encoding] of [
    ["br, gzip", "br"],
    ["gzip, deflate", "gzip"],
    ["gzip, br;q=0", "gzip"],
    ["identity", null],
  ] as const) {
    it(`is sent ${encoding ?? "uncompressed"} to clients that accept ${accepted}`, async (url) => {
      const response = await fetch(`${url}/brand`, {
        headers: { "accept-encoding": accepted },
        decompress: false,
      });
      expect(response.headers.get("content-encoding")).toBe(encoding);
      const body = new Uint8Array(await response.arrayBuffer());
      const { html } = await brand(url);
      if (encoding === null) expect(new TextDecoder().decode(body)).toBe(html);
      else expect(body.byteLength).toBeLessThan(html.length / 3);
    });
  }

  it("is not acceptable to a client that refuses every coding", async (url) => {
    const response = await fetch(`${url}/brand`, {
      headers: { "accept-encoding": "*;q=0" },
      decompress: false,
    });
    expect(response.status).toBe(406);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("cache-control")).toBe(CacheControl.failure);
    expect(await response.text()).not.toContain("<html");
  });

  it("is valid HTML", async (url) => {
    const { html } = await brand(url);
    expect(await htmlProblems(html)).toEqual([]);
  });

  it("is English, with one header, main and footer, and headings in order", async (url) => {
    const { html } = await brand(url);
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

  it("loads nothing from another origin but a portrait, and runs no JavaScript", async (url) => {
    const { html } = await brand(url);
    const css = await (await fetch(`${url}${stylesheetOf(html)}`)).text();
    const loaded = [...subresources(html), ...stylesheetUrls(css)];
    expect(loaded.length).toBeGreaterThan(4);
    expect(loaded.filter((path) => !/^\/(?!\/)/.test(path))).toEqual([
      erikPortrait,
    ]);
    expect(css).not.toContain("@import");
    expect(html).not.toMatch(/<script|\son[a-z]+=|javascript:/i);
    const files = await readdir(new URL("../dist/public", import.meta.url), {
      recursive: true,
    });
    expect(files.filter((file) => /\.m?js$/.test(file))).toEqual([]);
  });

  it(`gzips to at most ${htmlBudget} bytes of HTML and ${cssBudget} of CSS`, async (url) => {
    const { html } = await brand(url);
    const css = await (await fetch(`${url}${stylesheetOf(html)}`)).text();
    expect(gzipped(html)).toBeLessThanOrEqual(htmlBudget);
    expect(gzipped(css)).toBeLessThanOrEqual(cssBudget);
  });

  it("shows every color with its token, hex and computed contrast", async (url) => {
    const { html } = await brand(url);
    const lc = (text: string, ground: string) =>
      `Lc ${Math.abs(apcaContrast(text, ground)).toFixed(1)}`;
    const hex = (name: string) =>
      colors(tokens).find((color) => color.name === name)?.hex ?? "";
    const grounds = [hex("paper"), hex("night")];
    expect(grounds).not.toContain("");
    for (const color of colors(tokens)) {
      const kebab = color.name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      expect(html).toContain(`<code>--at-color-${kebab}</code>`);
      expect(html).toContain(`<span>${color.hex}</span>`);
      for (const ground of grounds) {
        if (ground !== color.hex) expect(html).toContain(lc(color.hex, ground));
      }
    }
    for (const pair of contrastRequirements(tokens)) {
      const ratio = wcagContrast(pair.text.hex, pair.background.hex);
      expect(html).toContain(`<td>${ratio.toFixed(1)}:1</td>`);
    }
  });

  it("renders brand/foundations.md under the page's own title", async (url) => {
    const { html } = await brand(url);
    expect(html).toContain("<h1 ");
    expect(html).toContain("<h2>all things/_ — brand foundations</h2>");
    expect(html).toContain("<h3>Who we are</h3>");
    expect(html).toContain(
      '<section class="scroll" aria-label="Color" tabindex="0"><table>',
    );
  });

  it("signs off with the hosts' portraits from their profiles, by id, and the socials in order", async (url) => {
    const { response, html } = await brand(url);
    expect(response.headers.get("cache-control")).toBe(CacheControl.page);
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
    const elsewhere =
      /<nav aria-label="all things elsewhere">(.*?)<\/nav>/.exec(html)?.[1];
    expect(
      [...(elsewhere ?? "").matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map(
        ([, href, name]) => ({ name, href }),
      ),
    ).toEqual([...socials]);
    expect(elsewhere).toContain(
      '<li><a href="https://www.linkedin.com/company/all-things-web-dev/">linkedin</a></li></ul>',
    );
  });

  it("shows the blank avatars, and is never stored, without a database", async (_, noDatabase) => {
    const { response, html } = await brand(noDatabase);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(CacheControl.failure);
    const images = portraits(html);
    expect(images).toHaveLength(2);
    for (const image of images) expect(image).toMatch(blankAvatar);
  });
});

describe("the mode switch", () => {
  const manual = { redirect: "manual" } as const;

  for (const choice of ["light", "dark"] as const) {
    it(`remembers ?theme=${choice} for a long while and shows the page again without it`, async (url) => {
      const response = await fetch(`${url}/brand?theme=${choice}`, manual);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/brand");
      expect(response.headers.get("cache-control")).toBe(
        preferenceCacheControl,
      );
      expect(response.headers.get("set-cookie")).toBe(
        `theme=${choice}; Max-Age=${Duration.toSeconds(themeCookieMaxAge)}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      );
      expect(await response.text()).toBe("");
    });
  }

  it("forgets the choice for ?theme=system", async (url) => {
    const response = await fetch(`${url}/brand?theme=system`, manual);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/brand");
    expect(response.headers.get("cache-control")).toBe(preferenceCacheControl);
    expect(response.headers.get("set-cookie")).toBe(
      "theme=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
    );
    await response.arrayBuffer();
  });

  it("keeps the rest of the query when it redirects", async (url) => {
    const response = await fetch(`${url}/brand?a=1&theme=dark&b=2`, manual);
    expect(response.headers.get("location")).toBe("/brand?a=1&b=2");
    await response.arrayBuffer();
  });

  it("ignores a mode it doesn't know", async (url) => {
    const { response, html } = await brand(url, "?theme=sepia", manual);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(html).toStartWith('<!doctype html><html lang="en">');
  });

  for (const [cookie, attribute, scheme, current, cacheControl] of [
    [undefined, "", "light dark", "system", CacheControl.page],
    [
      "theme=light",
      ' data-theme="light"',
      "light",
      "paper",
      PrivateCacheControl.page,
    ],
    [
      "theme=dark",
      ' data-theme="dark"',
      "dark",
      "night",
      PrivateCacheControl.page,
    ],
    ["theme=sepia", "", "light dark", "system", CacheControl.page],
    [
      "other=1; theme=dark",
      ' data-theme="dark"',
      "dark",
      "night",
      PrivateCacheControl.page,
    ],
  ] as const) {
    it(`renders ${cookie ?? "no cookie"} as ${current}, cached ${cacheControl}`, async (url) => {
      const { response, html } = await brand(
        url,
        "",
        cookie === undefined ? {} : { headers: { cookie } },
      );
      expect(html).toStartWith(
        `<!doctype html><html lang="en"${attribute}><head>`,
      );
      expect(html).toContain(`<meta name="color-scheme" content="${scheme}"/>`);
      expect(html.match(/<a [^>]*aria-current="true"[^>]*>([^<]*)</)?.[1]).toBe(
        current,
      );
      expect(response.headers.get("cache-control")).toBe(cacheControl);
      expect(response.headers.get("vary")).toBe("accept-encoding, cookie");
    });
  }

  it("is three links in the header, labelled mode, that crawlers don't follow", async (url) => {
    const { html } = await brand(url);
    const header = /<header class="site-header">(.*?)<\/header>/.exec(
      html,
    )?.[1];
    expect(header).toContain(
      '<nav class="modes at-type-meta" aria-labelledby="mode"><span id="mode">mode</span><ul><li><a href="?theme=system" rel="nofollow" aria-current="true">system</a></li><li><a href="?theme=light" rel="nofollow">paper</a></li><li><a href="?theme=dark" rel="nofollow">night</a></li></ul></nav>',
    );
  });

  it("works end to end: choose night, see night on every page, then the system's again", async (url) => {
    /** Chooses `choice` with `cookie`; where it goes and the cookie it sets. */
    const choose = async (choice: string, cookie?: string) => {
      const response = await fetch(
        `${url}/brand?theme=${choice}`,
        cookie === undefined ? manual : { ...manual, headers: { cookie } },
      );
      await response.arrayBuffer();
      const [pair = ""] = (response.headers.get("set-cookie") ?? "").split(";");
      return { location: response.headers.get("location"), pair };
    };
    const night = await choose("dark");
    expect(night.pair).toBe("theme=dark");
    const { html } = await brand(url, "", {
      headers: { cookie: night.pair },
    });
    expect(html).toStartWith(
      '<!doctype html><html lang="en" data-theme="dark">',
    );
    const system = await choose("system", night.pair);
    expect(system.pair).toBe("theme=");
    // An emptied cookie is no choice.
    const again = await brand(url, "", { headers: { cookie: system.pair } });
    expect(again.html).toStartWith('<!doctype html><html lang="en"><head>');
    expect(again.response.headers.get("cache-control")).toBe(CacheControl.page);
  });

  for (const cookie of ["theme=light", "theme=dark"]) {
    it(`stays within budget and runs no JavaScript with ${cookie}`, async (url) => {
      const { html } = await brand(url, "", { headers: { cookie } });
      expect(gzipped(html)).toBeLessThanOrEqual(htmlBudget);
      expect(html).not.toMatch(/<script|\son[a-z]+=|javascript:/i);
      expect(await htmlProblems(html)).toEqual([]);
    });
  }
});

/** Every kind of event page the catalog has, and the page for none. */
const eventPages = [
  ["an upcoming evening", `/${slugs.upcoming}`],
  ["a live evening", `/${slugs.live}`],
  ["a past evening with photos", `/${slugs.past}`],
  ["a past hackathon", `/${slugs.hackathon}`],
  ["a morning without a venue", `/${slugs.bare}`],
  ["not found", "/no-such-evening"],
] as const;

describe("links within the site", () => {
  const site = "https://allthings.dev";
  for (const path of [
    "/",
    "/events",
    "/people",
    "/about",
    "/brand",
    ...eventPages.map(([, eventPage]) => eventPage),
  ]) {
    it(`${path} links within the stage it is served from: no absolute link to the site outside its head`, async (url) => {
      const html = await (await fetch(`${url}${path}`)).text();
      const [head = "", body = ""] = html.split("</head>");
      expect(body.length).toBeGreaterThan(0);
      expect(body.match(/href="https?:\/\/[^"]*"/g) ?? []).not.toContainEqual(
        expect.stringMatching(new RegExp(`^href="${site}(?:[/?#"])`)),
      );
      expect(body).not.toContain(`"${site}`);
      // The head still names the production site: canonical and link previews.
      expect(head).toContain(`<link rel="canonical" href="${site}`);
    });
  }
});

describe("/about", () => {
  const about = async (url: string, init?: RequestInit) => {
    const response = await fetch(`${url}/about`, init);
    return { response, html: await response.text() };
  };

  it("answers with HTML cached like public data, linked from every footer", async (url) => {
    const { response, html } = await about(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(CacheControl.publicData);
    expect(response.headers.get("content-security-policy")).toBe(
      contentSecurityPolicy.originals,
    );
    const brandHtml = await (await fetch(`${url}/brand`)).text();
    for (const page of [html, brandHtml]) {
      expect(page).toContain(
        '<p><a href="/about">hosted by Erik &amp; Andre</a></p>',
      );
    }
  });

  it("counts the evenings held, who was on stage, who hosted, and who came, from the data", async (url) => {
    const { html } = await about(url);
    // The past evening at Sanity and the hackathon; the live evening and
    // the draft don't count yet or at all.
    expect(
      [
        ...html.matchAll(/<dt class="at-type-meta">([^<]+)<\/dt><dd>([^<]+)</g),
      ].map(([, label, value]) => [label, value]),
    ).toEqual([
      ["evenings", "2"],
      ["people on stage", "2"],
      ["hosting companies", "2"],
      ["guests, as Luma counted them", "146"],
    ]);
    expect(html).toContain(
      'since <time datetime="2025-01-29T01:00:00.000Z">Tue Jan 28, 2025</time>',
    );
    expect(html).toContain("they went by All Things Web.");
    expect(html).toContain(`<a class="row" href="/${slugs.past}">`);
  });

  it("shows the organizers from their profiles, by id", async (url) => {
    const { html } = await about(url);
    expect(html).toContain(
      `<img class="portrait" src="${erikPortrait}" alt=""`,
    );
    expect(html).toContain(
      `<h3 class="person-name"><a href="/people#p-${hosts[0].profileId}">Erik Thorelli</a></h3>`,
    );
    expect(html).toContain(
      `<h3 class="person-name"><a href="/people#p-${hosts[1].profileId}">Andre Landgraf</a></h3>`,
    );
    // Another profile is named Andre Landgraf and has a photo.
    expect(html).not.toContain("not-andre");
  });

  it("is valid HTML, with one h1, landmarks and headings in order, and runs no JavaScript", async (url) => {
    const { html } = await about(url);
    expect(await htmlProblems(html)).toEqual([]);
    for (const landmark of ["header", "main", "footer"]) {
      expect(html.match(new RegExp(`<${landmark}[ >]`, "g"))).toHaveLength(1);
    }
    const levels = headingLevels(html);
    expect(levels[0]).toBe(1);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    levels.forEach((level, index) => {
      expect(level).toBeLessThanOrEqual((levels[index - 1] ?? 0) + 1);
    });
    expect(html).not.toMatch(/<script|\son[a-z]+=|javascript:/i);
    for (const src of subresources(html).filter(
      (path) => !/^\/(?!\/)/.test(path),
    )) {
      expect(src).toStartWith(`${mediaOrigin}/`);
    }
  });

  for (const cookie of [undefined, "theme=light", "theme=dark"]) {
    it(`gzips within budget${cookie === undefined ? "" : ` with ${cookie}`}`, async (url) => {
      const { response, html } = await about(
        url,
        cookie === undefined ? {} : { headers: { cookie } },
      );
      const css = await (await fetch(`${url}${stylesheetOf(html)}`)).text();
      expect(gzipped(html)).toBeLessThanOrEqual(htmlBudget);
      expect(gzipped(css)).toBeLessThanOrEqual(cssBudget);
      if (cookie !== undefined) {
        expect(response.headers.get("cache-control")).toBe(
          PrivateCacheControl.publicData,
        );
      }
    });
  }
});

describe("names on event pages", () => {
  it("link to an entry that exists on /people, for everyone on stage and every co-host and MC", async (url) => {
    const people = await (await fetch(`${url}/people`)).text();
    const anchors = new Set(
      [...people.matchAll(/<li class="person" id="([^"]+)">/g)].map(
        ([, id]) => id,
      ),
    );
    const linked = new Set<string>();
    for (const slug of [slugs.upcoming, slugs.past]) {
      const html = await (await fetch(`${url}/${slug}`)).text();
      for (const [, id = ""] of html.matchAll(/href="\/people#([^"]+)"/g)) {
        linked.add(id);
      }
    }
    // Ada and Grace: on stage, a co-host and an MC between the two pages.
    expect(linked.size).toBe(2);
    for (const id of linked) expect(anchors).toContain(id);
  });
});

describe("event pages", () => {
  for (const [name, path] of eventPages) {
    it(`${name} is valid HTML, with one h1, landmarks and headings in order`, async (url) => {
      const html = await (await fetch(`${url}${path}`)).text();
      expect(await htmlProblems(html)).toEqual([]);
      expect(html).toStartWith('<!doctype html><html lang="en"');
      for (const landmark of ["header", "main", "footer"]) {
        expect(html.match(new RegExp(`<${landmark}[ >]`, "g"))).toHaveLength(1);
      }
      const levels = headingLevels(html);
      expect(levels.filter((level) => level === 1)).toHaveLength(1);
      expect(levels[0]).toBe(1);
      levels.forEach((level, index) => {
        expect(level).toBeLessThanOrEqual((levels[index - 1] ?? 0) + 1);
      });
      // Every link says where it goes: text a screen reader can read.
      for (const [, inner = ""] of html.matchAll(/<a [^>]*>(.*?)<\/a>/g)) {
        expect(
          inner
            .replace(/<span aria-hidden="true">[^<]*<\/span>/g, "")
            .replace(/<[^>]+>/g, "")
            .trim(),
        ).not.toBe("");
      }
    });

    it(`${name} loads only this site's files and the media origin's images, and runs no JavaScript`, async (url) => {
      const page = await (await fetch(`${url}${path}`)).text();
      // Its one script element is JSON-LD data, which never runs.
      const html = page.replace(
        /<script type="application\/ld\+json">[^<]*<\/script>/g,
        "",
      );
      const elsewhere = subresources(html).filter(
        (src) => !/^\/(?!\/)/.test(src),
      );
      for (const src of elsewhere) expect(src).toStartWith(`${mediaOrigin}/`);
      expect(html).not.toMatch(/<script|\son[a-z]+=|javascript:/i);
    });

    for (const cookie of [undefined, "theme=light", "theme=dark"]) {
      it(`${name} gzips within budget${cookie === undefined ? "" : ` with ${cookie}`}`, async (url) => {
        const response = await fetch(
          `${url}${path}`,
          cookie === undefined ? {} : { headers: { cookie } },
        );
        const html = await response.text();
        const css = await (await fetch(`${url}${stylesheetOf(html)}`)).text();
        expect(gzipped(html)).toBeLessThanOrEqual(htmlBudget);
        expect(gzipped(css)).toBeLessThanOrEqual(cssBudget);
      });
    }
  }
});

describe("the Worker", () => {
  it(`starts from at most ${bundleBudgets.startup} bytes gzipped, and loads no module over ${bundleBudgets.lazy} on first use`, async () => {
    // Where Alchemy wrote the bundle it just ran, as it deploys it.
    const problems = await budgetProblems(
      new URL("../.alchemy/bundles/Pages", import.meta.url).pathname,
      bundleBudgets,
    );
    expect(problems).toBeUndefined();
  });
});

describe("static assets", () => {
  it("serve every file the page loads, by content hash, for a year", async (url) => {
    const { html } = await brand(url);
    const types: Record<string, string> = {
      css: "text/css",
      woff2: "font/woff2",
      svg: "image/svg+xml",
      png: "image/png",
    };
    const css = await (await fetch(`${url}${stylesheetOf(html)}`)).text();
    const files = new Set(
      [...subresources(html), ...stylesheetUrls(css)].filter((path) =>
        path.startsWith("/"),
      ),
    );
    for (const path of files) {
      expect(path).toMatch(
        /^\/assets\/[a-z-]+\.[0-9a-f]{16}\.(css|woff2|svg|png)$/,
      );
      const response = await fetch(`${url}${path}`);
      expect(response.status).toBe(200);
      const extension = path.split(".").at(-1) ?? "";
      expect(response.headers.get("content-type")).toStartWith(
        types[extension] ?? "?",
      );
      expect(response.headers.get("cache-control")).toBe(immutable);
      await response.arrayBuffer();
    }
  });

  it("preload only Archivo's latin subset", async (url) => {
    const { html } = await brand(url);
    const preloads = html.match(/<link rel="preload"[^>]*>/g) ?? [];
    expect(preloads).toHaveLength(1);
    expect(preloads[0]).toMatch(
      /href="\/assets\/archivo-latin-wdth-normal\.[0-9a-f]{16}\.woff2" as="font" type="font\/woff2" crossorigin=""/,
    );
  });

  it("answer a file that isn't there with 404, through the Worker", async (url) => {
    const response = await fetch(`${url}/assets/site.0000000000000000.css`);
    expect(response.status).toBe(404);
    await response.arrayBuffer();
  });
});
