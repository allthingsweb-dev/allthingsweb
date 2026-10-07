import { describe, expect } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { CacheControl } from "../src/cache.ts";
import { eventDatabase } from "./support/event-catalog.ts";
import {
  fileEntryFor,
  legacyUrls,
  routeEntryFor,
} from "./support/legacy-urls.ts";
import { serve } from "./support/socket.ts";
import { testStack } from "./support/stack.ts";

const app = new URL("../../app/", import.meta.url).pathname;

/** The app's routes, as paths: app/src/app/about/page.tsx is "/about". */
const appRoutes = Array.from(
  new Bun.Glob("src/app/**/{page.tsx,route.ts,route.tsx,manifest.ts}").scanSync(
    app,
  ),
  (file) =>
    file === "src/app/manifest.ts"
      ? "/manifest.webmanifest"
      : `/${file.split("/").slice(2, -1).join("/")}`,
).toSorted();

/** The app's public files, as paths: app/public/favicon.ico is "/favicon.ico". */
const publicFiles = Array.from(
  new Bun.Glob("**/*").scanSync(`${app}public`),
  (file) => `/${file}`,
).toSorted();

/** The type a public file is served as, by its extension. */
const fileTypes: Readonly<Record<string, string>> = {
  ico: "image/vnd.microsoft.icon",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
};

/**
 * Every URL the current site answers keeps working on the Worker, served or
 * redirected as support/legacy-urls.ts says, against the event catalog.
 */

const database = await serve(await eventDatabase(new Date()));

const Stack = testStack("allthings-web-legacy-urls-test", {
  Site: { ORIGIN: "https://allthings.dev", DATABASE_URL: database.url },
});

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});
const workers = beforeAll(deploy(Stack));
afterAll(
  destroy(Stack).pipe(Effect.ensuring(Effect.promise(() => database.stop()))),
);

const it = (name: string, run: (url: string) => Promise<void>) =>
  test(
    name,
    Effect.flatMap(workers, (outputs) =>
      Effect.promise(() => {
        const url = outputs["Site"];
        if (typeof url !== "string" || !url.startsWith("http://localhost")) {
          throw new Error(`Site is not running locally: ${String(url)}`);
        }
        return run(url);
      }),
    ),
  );

describe("legacy URLs", () => {
  for (const legacy of legacyUrls) {
    const { worker } = legacy;
    it(`${legacy.pattern} (${legacy.example}) answers ${worker.status}${"location" in worker ? ` → ${worker.location}` : ""}`, async (url) => {
      const response = await fetch(`${url}${legacy.example}`, {
        redirect: "manual",
      });
      await response.arrayBuffer();
      expect(response.status).toBe(worker.status);
      if ("location" in worker) {
        expect(response.headers.get("location")).toBe(worker.location);
      }
      if ("type" in worker) {
        expect(response.headers.get("content-type") ?? "").toStartWith(
          worker.type,
        );
      }
    });
  }

  it("names every route in the app's tree", () => {
    expect(appRoutes.length).toBeGreaterThan(40);
    expect(
      appRoutes.filter((route) => routeEntryFor(route) === undefined),
    ).toEqual([]);
    return Promise.resolve();
  });

  it("answers every route a wildcard entry covers as that entry says", async (url) => {
    // Routes without parameters, such as /admin/raw/talks under /admin/*: one
    // example per entry would not show that each of them answers alike.
    const covered = appRoutes.flatMap((route) => {
      const entry = routeEntryFor(route);
      return entry?.pattern.includes("*") === true && !route.includes("[")
        ? [{ route, entry }]
        : [];
    });
    expect(covered.length).toBeGreaterThan(10);
    // One at a time: the test database takes only a few connections.
    const wrong = [];
    for (const { route, entry } of covered) {
      const response = await fetch(`${url}${route}`, { redirect: "manual" });
      await response.arrayBuffer();
      if (response.status !== entry.worker.status) {
        wrong.push({
          route,
          expected: entry.worker.status,
          answer: response.status,
        });
      }
    }
    expect(wrong).toEqual([]);
  });

  it("answers for every file in the app's public folder as its entry says", async (url) => {
    expect(publicFiles.length).toBeGreaterThan(40);
    // One at a time: the test database takes only a few connections.
    const wrong = [];
    for (const path of publicFiles) {
      const response = await fetch(`${url}${path}`, { redirect: "manual" });
      await response.arrayBuffer();
      const status = fileEntryFor(path)?.worker.status;
      const type =
        status === 200
          ? fileTypes[path.split(".").at(-1) ?? ""]
          : "text/html; charset=utf-8";
      const answer = {
        status: response.status,
        type: response.headers.get("content-type"),
      };
      if (answer.status !== status || answer.type !== type) {
        wrong.push({ path, expected: { status, type }, answer });
      }
    }
    expect(wrong).toEqual([]);
  });

  it("answers what isn't found with the site's own page", async (url) => {
    const response = await fetch(`${url}/no/such/page`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(await response.text()).toContain("404 · not found");
  });

  it("says what is retired is gone, under the address asked for", async (url) => {
    const response = await fetch(`${url}/logos/logo-1.91x1.png`);
    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe(CacheControl.page);
    const html = await response.text();
    expect(html).toContain("410 · gone");
    // In what the page says, not in its markup: an asset's hash may hold "404".
    expect(html.replace(/<[^>]*>/g, "")).not.toContain("404");
    expect(html).toContain(
      '<link rel="canonical" href="https://allthings.dev/logos/logo-1.91x1.png"/>',
    );
  });

  it("says sign-in, profiles and the admin are gone, for every method, and leads home", async (url) => {
    for (const [path, method] of [
      ["/profile", "GET"],
      ["/handler/sign-in", "GET"],
      ["/admin", "GET"],
      ["/admin/raw/talks", "GET"],
      ["/api/v1/profile", "PUT"],
      ["/api/v1/admin/raw/talks", "DELETE"],
      ["/api/v1/admin/upload-event-images", "POST"],
    ] as const) {
      const response = await fetch(`${url}${path}`, {
        method,
        redirect: "manual",
      });
      expect({ path, method, status: response.status }).toEqual({
        path,
        method,
        status: 410,
      });
      expect(response.headers.get("content-type")).toBe(
        "text/html; charset=utf-8",
      );
      expect(response.headers.get("cache-control")).toBe(CacheControl.page);
      const html = await response.text();
      expect(html).toContain('<a href="/">Go to the home page</a>');
      expect(html).toContain('<meta name="robots" content="noindex">');
    }
  });

  it("names a retired folder by its own path, never its route's", async (url) => {
    for (const path of ["/logos", "/logos/"]) {
      const response = await fetch(`${url}${path}`, { redirect: "manual" });
      const html = await response.text();
      expect(response.status).toBe(410);
      expect(html).toContain(
        '<link rel="canonical" href="https://allthings.dev/logos"/>',
      );
    }
    const choice = await fetch(`${url}/logos?theme=dark`, {
      redirect: "manual",
    });
    await choice.arrayBuffer();
    expect(choice.headers.get("location")).toBe("/logos");
  });

  it("never sends a trailing slash to another host", async (url) => {
    const response = await fetch(`${url}//elsewhere.example/`, {
      redirect: "manual",
    });
    await response.arrayBuffer();
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("/elsewhere.example");
  });

  it("never sends a backslash path to another host", async (url) => {
    for (const path of [
      "/%5Celsewhere.example/",
      "/%2F%5Celsewhere.example/",
    ]) {
      const response = await fetch(`${url}${path}`, { redirect: "manual" });
      await response.arrayBuffer();
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe("/elsewhere.example");
    }
  });

  it("keeps the query when it drops a trailing slash", async (url) => {
    const response = await fetch(`${url}/events/?a=1`, { redirect: "manual" });
    await response.arrayBuffer();
    expect(response.headers.get("location")).toBe("/events?a=1");
  });
});
