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
import * as Effect from "effect/Effect";
import { immutable } from "../scripts/build.ts";
import { CacheControl } from "../src/cache.ts";
import { contentSecurityPolicy } from "../src/pages/response.ts";
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
import { testStack } from "./support/stack.ts";

/**
 * The site's pages, served by the Worker in workerd with its static assets,
 * as they deploy. No database: /brand needs none.
 */

const Stack = testStack("allthings-web-pages-test", {
  Pages: { ORIGIN: "https://allthings.dev" },
});

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});
const workers = beforeAll(deploy(Stack));
afterAll(destroy(Stack));

/** A test that gets the running Worker's URL. */
const it = (name: string, run: (url: string) => Promise<void>) =>
  test(
    name,
    Effect.flatMap(workers, (outputs) =>
      Effect.promise(() => {
        const url = outputs["Pages"];
        if (typeof url !== "string" || !url.startsWith("http://localhost")) {
          throw new Error(`Pages is not running locally: ${String(url)}`);
        }
        return run(url);
      }),
    ),
  );

const brand = async (url: string, query = "") => {
  const response = await fetch(`${url}/brand${query}`);
  return { response, html: await response.text() };
};

describe("/brand", () => {
  it("answers with HTML that caches and may load only this site's files", async (url) => {
    const { response } = await brand(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(CacheControl.page);
    expect(response.headers.get("content-security-policy")).toBe(
      contentSecurityPolicy,
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("vary")).toBe("accept-encoding");
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

  it("loads nothing from another origin and runs no JavaScript", async (url) => {
    const { html } = await brand(url);
    const css = await (await fetch(`${url}${stylesheetOf(html)}`)).text();
    const loaded = [...subresources(html), ...stylesheetUrls(css)];
    expect(loaded.length).toBeGreaterThan(4);
    for (const path of loaded) expect(path).toMatch(/^\/(?!\/)/);
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
    for (const color of colors(tokens)) {
      const kebab = color.name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      expect(html).toContain(`<code>--at-color-${kebab}</code>`);
      expect(html).toContain(`<span>${color.hex}</span>`);
      for (const ground of ["#F4F1EC", "#1C1236"]) {
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

  it("signs off with the hosts, the blank avatar standing in for portraits", async (url) => {
    const { html } = await brand(url);
    expect(html).toContain("<p>hosted by Erik &amp; Andre</p>");
    expect(
      html.match(/<img src="\/assets\/avatar\.[0-9a-f]{16}\.svg" alt=""/g),
    ).toHaveLength(2);
    expect(html).toContain('<a href="https://x.com/allthingswebdev">x</a>');
  });

  for (const [query, attribute] of [
    ["", '<html lang="en">'],
    ["?theme=dark", '<html lang="en" data-theme="dark">'],
    ["?theme=light", '<html lang="en" data-theme="light">'],
    ["?theme=sepia", '<html lang="en">'],
  ] as const) {
    it(`${query || "without a theme"} sets the mode to ${attribute}`, async (url) => {
      const { response, html } = await brand(url, query);
      expect(response.status).toBe(200);
      expect(html).toStartWith(`<!doctype html>${attribute}`);
    });
  }
});

describe("the Worker", () => {
  // Workers on the free plan may be 3 MB gzipped; we hold ours far below
  // that, since every cold start parses all of it.
  const bundleBudget = 300_000;

  it(`bundles to at most ${bundleBudget} bytes gzipped`, async () => {
    // Where Alchemy wrote the bundle it just ran, as it deploys it.
    const bundle = Bun.file(
      new URL("../.alchemy/bundles/Pages/worker.js", import.meta.url),
    );
    expect(await bundle.exists()).toBe(true);
    expect(gzipped(await bundle.text())).toBeLessThanOrEqual(bundleBudget);
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
    const files = new Set([...subresources(html), ...stylesheetUrls(css)]);
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
