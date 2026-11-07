import { describe, expect, test } from "bun:test";
import {
  isNotFoundShape,
  notFoundKinds,
  notFoundShape,
  type NotFoundKind,
} from "../src/not-found.ts";

/**
 * Paths from a week of allthings.dev's 404s in Workers Logs (2026-11),
 * the secrets in them replaced by stand-ins.
 */
const cases: ReadonlyArray<readonly [string, NotFoundKind, string]> = [
  // Asked for by browsers and crawlers on their own.
  ["/.well-known/traffic-advice", "well-known", "/.well-known/traffic-advice"],
  ["/.well-known/security.txt", "well-known", "/.well-known/security.txt"],
  ["/.well-known/stripe", "well-known", "/.well-known/(other)"],
  [
    "/apple-touch-icon-precomposed.png",
    "well-known",
    "/apple-touch-icon-precomposed.png",
  ],
  ["/llms.txt", "well-known", "/llms.txt"],
  // The old sites' URLs.
  ["/img", "legacy", "/img (the Remix site's images)"],
  [
    "/img/pocketbase/speakers/8twvwcgpn6yla88/someone_lldAZ3L23C.png",
    "legacy",
    "/img/pocketbase/speakers/…",
  ],
  [
    "/img/pocketbase/members/1qtz6each0yk5cj/profile_uZi4ogk2Td.png",
    "legacy",
    "/img/pocketbase/members/…",
  ],
  ["/img/pocketbase/Secret-Thing/x.png", "legacy", "/img/pocketbase/(other)/…"],
  ["/_next/static/chunks/app.js", "legacy", "/_next/…"],
  ["/2026-10-29-agents-for-web-dev", "legacy", "/(dated slug)"],
  [
    "/2024-11-12-all-things-web-at-vercel/preview.png",
    "legacy",
    "/(dated slug)/preview.png",
  ],
  ["/api/cron/luma-sync", "legacy", "/api/cron/luma-sync"],
  // Scanners.
  ["/.env", "probe", "(probe: env)"],
  ["/laravel/.env.local", "probe", "(probe: env)"],
  ["/%2fbackend%2f%2eenv", "probe", "(probe: env)"],
  ["/.git/config", "probe", "(probe: version control)"],
  ["/wordpress", "probe", "(probe: wordpress)"],
  ["/wp-admin/install.php", "probe", "(probe: wordpress)"],
  ["/_profiler/phpinfo", "probe", "(probe: php)"],
  ["/.well-known/leaf.php", "probe", "(probe: php)"],
  ["/.aws/credentials", "probe", "(probe: cloud credentials)"],
  ["/ssl/stand-in.key", "probe", "(probe: keys and certificates)"],
  ["/terraform.tfvars", "probe", "(probe: terraform)"],
  ["/server-status", "probe", "(probe: server internals)"],
  ["/graphql", "probe", "(probe: graphql and api)"],
  ["/rest/settings", "probe", "(probe: other software)"],
  ["/backup.sql", "probe", "(probe: backups)"],
  ["/docker-compose.yml", "probe", "(probe: config and source files)"],
  ["/config.js", "probe", "(probe: config and source files)"],
  ["/%E0%A4%A", "probe", "(probe: malformed)"],
  // Guesses.
  ["/press", "guessed", "/press"],
  ["/blog", "guessed", "/blog"],
  ["/Contact", "guessed", "/contact"],
  ["/people/No.One", "guessed", "/people/(slug)"],
  ["/events/correct-horse-battery-staple", "guessed", "/events/(slug)"],
  ["/no-such-evening", "guessed", "/(slug)"],
  ["/abcdefgh", "guessed", "/(word)"],
  ["/r/x7k9q2m4", "guessed", "/r/(slug)"],
  ["/blog/2024", "guessed", "/blog/(code)"],
  ["/x7k9q2m4AbC", "guessed", "/(code)"],
  // Anything else.
  [
    "/img/240/jpeg/1791090037/events/a/b.jpg%20240w,%20/img/360/jpeg/1791090037/events/a/b.jpg%20360w",
    "other",
    "/img/… (a srcset read as one URL)",
  ],
  ["/img/240/jpeg/1/events/a/missing.jpg", "other", "/img/…"],
  [
    "//static.cloudflareinsights.com/beacon.min.js",
    "other",
    "(protocol-relative URL)",
  ],
  ["/", "other", "/"],
  ["/shop/[category]/item", "other", "/(word)/…"],
];

describe("notFoundShape", () => {
  test("gives each kind of 404 its kind and a shape", () => {
    for (const [path, kind, shape] of cases) {
      expect([path, notFoundShape(path)]).toEqual([path, { kind, shape }]);
    }
  });

  test("covers every kind", () => {
    const seen = new Set(cases.map(([, kind]) => kind));
    expect([...notFoundKinds].filter((kind) => !seen.has(kind))).toEqual([]);
  });

  test("never keeps what a crafted URL carries: no address, token, key or passphrase", () => {
    for (const path of [
      "/alice%40example.com",
      "/people/alice@example.com",
      "/api/AKIAIOSFODNN7EXAMPLE",
      `/r/${["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJ0ZXN0In0", "c2lnbmF0dXJl"].join(".")}`,
      "/correct-horse-battery-staple",
      "/correct/horse/battery/staple",
      "/ssl/correct-horse.pem",
      "/img/pocketbase/speakers/correct/horse.png",
      "/.well-known/correct-horse",
    ]) {
      const { shape } = notFoundShape(path);
      expect([path, shape]).not.toEqual([
        path,
        expect.stringMatching(/alice|AKIA|eyJ|horse|staple|correct/i),
      ]);
      expect([path, isNotFoundShape(shape)]).toEqual([path, true]);
    }
  });
});

describe("isNotFoundShape", () => {
  test("is true for every shape notFoundShape gives", () => {
    for (const [path] of cases) {
      const { shape } = notFoundShape(path);
      expect([shape, isNotFoundShape(shape)]).toEqual([shape, true]);
    }
  });

  test("is false for a raw path, a pattern or a made-up family", () => {
    for (const path of [
      "/.env",
      "/people/alice%40example.com",
      "/correct-horse-battery",
      "/people/*",
      "(probe: correct horse)",
      "",
    ]) {
      expect([path, isNotFoundShape(path)]).toEqual([path, false]);
    }
  });
});
