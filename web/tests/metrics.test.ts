import { describe, expect, test } from "bun:test";
import {
  answeredBy,
  pathClass,
  pathLimit,
  recordRequest,
  redactedPath,
  REQUESTS_DATASET,
  requestDatasetOf,
  requestPoint,
  visitorKind,
} from "../src/metrics.ts";
import {
  answeredQuery,
  formatReport,
  notFoundKindsQuery,
  statusQuery,
  storeHitRate,
  top404Query,
} from "../src/request-queries.ts";

const request = (path: string, init: RequestInit = {}) =>
  new Request(`https://allthings.dev${path}`, init);

describe("pathClass", () => {
  test("is the first segment, with /* when more follows", () => {
    for (const [path, kind] of [
      ["/", "/"],
      ["//", "/"],
      ["/about", "/about"],
      ["/people/erik-thorelli", "/people/*"],
      // Capitals aren't the site's: such a first segment is never an index.
      ["/Events/2024-11-12-all-things-web", "/(other)"],
      ["/img/240/avif/1791086442-q60/events/x.jpg", "/img/*"],
      ["/_site/prewarm", "/_site/*"],
    ] as const) {
      expect([path, pathClass(path)]).toEqual([path, kind]);
    }
  });

  test("puts a first segment no route could have in one class", () => {
    for (const path of [
      "/.env",
      "/wp-login.php",
      // A token-like first segment, or one with an address, is never an index.
      "/abcdefghijklmnopqrstuvwxyz012345",
      "/alice%40example.com",
      "/%2e%2e/etc",
      `/${"a".repeat(33)}`,
    ]) {
      expect([path, pathClass(path)]).toEqual([path, "/(other)"]);
    }
  });
});

describe("redactedPath", () => {
  test("keeps below the site's slug routes only segments of its own shape", () => {
    for (const [path, kept] of [
      ["/people/alice@example.com", "/people/(email)"],
      ["/people/alice%40example.com", "/people/(email)"],
      ["/people/alice%2540example.com", "/people/(email)"],
      ["/people/alice%2525252540example.com", "/people/(email)"],
      ["/events/" + "a1B2c3D4".repeat(4), "/events/(code)"],
      ["/events/550e8400-e29b-41d4-a716-446655440000", "/events/(code)"],
      ["/r/x7k9q2m4", "/r/(code)"],
      ["/r/123456", "/r/(code)"],
      ["/people/Erik-Thorelli", "/people/(code)"],
      ["/api/1234", "/api/(code)"],
      ["/people/abcdefgh", "/people/(word)"],
      // A path already stored redacted stays as it is.
      ["/people/(email)", "/people/(email)"],
      ["/people/(word)", "/people/(word)"],
      [
        // A JWT, built from its parts here so no scanner takes it for a real one.
        `/api/${["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJ0ZXN0In0", "c2lnbmF0dXJl"].join(".")}`,
        "/api/(code)",
      ],
      ["/events/%E0%A4%A", "/events/(malformed)"],
      ["/people/alice%40example.com%ZZ", "/people/(malformed)"],
      [`/people/a${"%25".repeat(9)}40b`, "/people/(malformed)"],
      // After 8 passes, 9 levels leave `%40`; 10 leave `%2540`.
      [`/people/alice${"%" + "25".repeat(8)}40example.com`, "/people/(email)"],
      [
        `/people/alice${"%" + "25".repeat(9)}40example.com`,
        "/people/(malformed)",
      ],
      // Stored paths stay the same on a second pass.
      ["/(word)/…", "/(word)/…"],
      ["/(code)", "/(code)"],
    ] as const) {
      expect([path, redactedPath(path)]).toEqual([path, kept]);
    }
  });

  test("keeps below any other first segment only that segment, and a photo variant as its class", () => {
    for (const [path, kept] of [
      ["/reset/123456", "/(word)/…"],
      ["/reset/abcdefgh", "/(word)/…"],
      ["/password-reset/abcdefgh", "/password-reset/…"],
      ["/abcdefgh", "/(word)"],
      ["/1234", "/(code)"],
      ["/invite/alice%40example.com/x", "/(word)/…"],
      ["/123456", "/(code)"],
      ["/alice%40example.com", "/(email)"],
      ["/img/240/avif/1791086442-q60/events/2024-11-12-all-thin.jpg", "/img/…"],
    ] as const) {
      expect([path, redactedPath(path)]).toEqual([path, kept]);
    }
  });

  test("keeps the site's own paths as they are", () => {
    for (const path of [
      "/",
      "/about",
      "/people/erik-thorelli",
      "/events/2024-11-12-all-things-web-at-vercel",
      "/lab/home/slash-grid",
      "/wp-login.php",
      "/sentry-example-page",
    ]) {
      expect(redactedPath(path)).toBe(path);
    }
  });
});

describe("answeredBy", () => {
  test("names the page store's or the variant's answer from Server-Timing", () => {
    const timed = (value: string) =>
      new Response(null, { headers: { "server-timing": value } });
    expect(
      answeredBy(timed('store;desc="hit";dur=11.0, pointer;desc="local"')),
    ).toBe("store-hit");
    expect(answeredBy(timed('store;desc="miss";dur=3.0, db;dur=40.1'))).toBe(
      "store-miss",
    );
    expect(answeredBy(timed('img;desc="stored";dur=2'))).toBe("img-stored");
    expect(answeredBy(timed("db;dur=4.0"))).toBe("none");
    expect(answeredBy(new Response(null))).toBe("none");
  });
});

describe("visitorKind", () => {
  test("is bot for a user agent that names itself automated, or none", () => {
    for (const agent of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "curl/8.7.1",
      "Slackbot-LinkExpanding 1.0",
      "",
      null,
    ]) {
      expect([agent, visitorKind(agent)]).toEqual([agent, "bot"]);
    }
  });

  test("is human for a browser", () => {
    expect(
      visitorKind(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
      ),
    ).toBe("human");
  });
});

describe("requestPoint", () => {
  test("holds the class, the path, what answered, the colo, the method, the kind, the status and the time", () => {
    const incoming = request("/people/erik-thorelli?utm_source=x", {
      headers: {
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0",
        "cf-connecting-ip": "203.0.113.9",
        cookie: "theme=dark",
        referer: "https://elsewhere.example/",
      },
    });
    Object.defineProperty(incoming, "cf", { value: { colo: "SJC" } });
    const point = requestPoint(
      incoming,
      new Response("x", {
        status: 200,
        headers: { "server-timing": 'store;desc="miss";dur=2.0' },
      }),
      37.5,
    );
    expect(point).toEqual({
      indexes: ["/people/*"],
      blobs: [
        "/people/*",
        "/people/erik-thorelli",
        "store-miss",
        "SJC",
        "GET",
        "human",
        "",
      ],
      doubles: [200, 37.5],
    });
  });

  test("keeps a 404's path as its shape and kind, so nothing a crafted URL carries is stored", () => {
    for (const [path, kind, shape] of [
      ["/r/correct-horse-battery-staple", "guessed", "/r/(slug)"],
      ["/correct-horse-battery-staple", "guessed", "/(slug)"],
      ["/people/alice%40example.com", "guessed", "/people/(slug)"],
      ["/backend/.env", "probe", "(probe: env)"],
      ["/ssl/correct-horse.key", "probe", "(probe: keys and certificates)"],
      ["/press", "guessed", "/press"],
    ] as const) {
      const point = requestPoint(
        request(path),
        new Response(null, { status: 404 }),
        1,
      );
      expect([path, point.blobs[1], point.blobs[6]]).toEqual([
        path,
        shape,
        kind,
      ]);
      expect(point.blobs.join(" ")).not.toMatch(/horse|alice|backend/);
    }
  });

  test("keeps the path of any other status but 200 as its class alone, with no kind", () => {
    for (const [path, status] of [
      ["/r/correct-horse-battery-staple", 410],
      ["/people/alice%40example.com", 400],
      // The mode's redirect answers any path, before its slug is read.
      ["/people/correct-horse-battery-staple?theme=system", 303],
      ["/api/v1/correct-horse-battery-staple/preview.png", 301],
    ] as const) {
      const point = requestPoint(
        request(path),
        new Response(null, { status }),
        1,
      );
      expect([path, point.blobs[1]]).toEqual([path, point.blobs[0]]);
      expect(point.blobs[6]).toBe("");
      expect(point.blobs.join(" ")).not.toMatch(/horse|alice/);
    }
  });

  test("keeps nothing that identifies a person: no query, address, agent, cookie or referrer", () => {
    const incoming = request("/about?email=someone%40example.com", {
      headers: {
        "user-agent": "Mozilla/5.0 UniqueAgent/9.9",
        "cf-connecting-ip": "203.0.113.9",
        cookie: "theme=dark",
        referer: "https://elsewhere.example/private",
      },
    });
    const text = JSON.stringify(requestPoint(incoming, new Response(null), 1));
    for (const secret of [
      "someone",
      "203.0.113.9",
      "UniqueAgent",
      "theme",
      "elsewhere",
    ]) {
      expect([secret, text.includes(secret)]).toEqual([secret, false]);
    }
  });

  test("keeps at most pathLimit characters of a path, and no negative time", () => {
    const point = requestPoint(
      request(`/${"ab-".repeat(200)}`),
      new Response(null),
      -3,
    );
    expect(point.blobs[1]).toHaveLength(pathLimit);
    expect(point.doubles[1]).toBe(0);
    expect(point.blobs[3]).toBe("");
  });
});

describe("recordRequest", () => {
  test("writes one point to the Worker's dataset", () => {
    const points: Array<unknown> = [];
    const env = {
      REQUESTS: { writeDataPoint: (point: unknown) => points.push(point) },
    };
    expect(requestDatasetOf(env)).toBe(env.REQUESTS);
    recordRequest(env, request("/"), new Response(null), Date.now() - 5);
    expect(points).toEqual([
      {
        indexes: ["/"],
        blobs: ["/", "/", "none", "", "GET", "bot", ""],
        doubles: [200, expect.any(Number)],
      },
    ]);
  });

  test("writes nothing for the writers' own paths, a prewarm's dry run among them", () => {
    const points: Array<unknown> = [];
    const env = {
      REQUESTS: { writeDataPoint: (point: unknown) => points.push(point) },
    };
    for (const path of [
      "/_site/prewarm?dry-run",
      "/_site/prewarm",
      "/_site/refresh",
      "/_site/variants-check",
    ]) {
      recordRequest(
        env,
        request(path, { method: "POST" }),
        new Response(null),
        Date.now(),
      );
    }
    expect(points).toEqual([]);
  });

  test("never throws, even when reading its binding does", () => {
    const env = Object.defineProperty({}, "REQUESTS", {
      get: () => {
        throw new Error("no binding");
      },
    }) as Readonly<Record<string, unknown>>;
    expect(() =>
      recordRequest(env, request("/"), new Response(null), Date.now()),
    ).not.toThrow();
  });

  test("does nothing without a dataset, and never throws when writing fails", () => {
    expect(requestDatasetOf({})).toBeUndefined();
    expect(requestDatasetOf({ REQUESTS: "nope" })).toBeUndefined();
    recordRequest({}, request("/"), new Response(null), 1);
    recordRequest({ REQUESTS: "nope" }, request("/"), new Response(null), 1);
    recordRequest(
      {
        REQUESTS: {
          writeDataPoint: () => {
            throw new Error("full");
          },
        },
      },
      request("/"),
      new Response(null),
      1,
    );
  });
});

describe("the request queries", () => {
  test("read prod's dataset, or the previews', over the window", () => {
    expect(top404Query("prod", 7, 20)).toBe(
      "SELECT blob7 AS kind, blob2 AS path, SUM(_sample_interval) AS requests, SUM(IF(blob6 = 'bot', _sample_interval, 0)) AS bots FROM allthings_requests WHERE timestamp > NOW() - INTERVAL '7' DAY AND double1 = 404 GROUP BY kind, path ORDER BY requests DESC LIMIT 20",
    );
    expect(notFoundKindsQuery("prod", 7)).toBe(
      "SELECT blob7 AS kind, SUM(_sample_interval) AS requests, SUM(IF(blob6 = 'bot', _sample_interval, 0)) AS bots FROM allthings_requests WHERE timestamp > NOW() - INTERVAL '7' DAY AND double1 = 404 GROUP BY kind ORDER BY requests DESC",
    );
    expect(answeredQuery("preview", 1)).toContain(
      `FROM ${REQUESTS_DATASET.preview} WHERE timestamp > NOW() - INTERVAL '1' DAY`,
    );
    expect(statusQuery("prod", 30)).toContain("GROUP BY status");
  });

  test("names only datasets Analytics Engine accepts", () => {
    for (const name of Object.values(REQUESTS_DATASET)) {
      expect(name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    }
  });

  test("give the page store's hit rate among the requests it was asked", () => {
    expect(
      storeHitRate([
        { answered: "store-hit", requests: "90" },
        { answered: "store-miss", requests: 10 },
        { answered: "store-bypass", requests: 500 },
        { answered: "none", requests: 7 },
      ]),
    ).toBe(0.9);
    expect(storeHitRate([{ answered: "none", requests: 3 }])).toBeUndefined();
  });

  test("format a report of statuses, answers and 404s", () => {
    expect(
      formatReport(
        { stage: "prod", days: 7 },
        {
          statuses: [
            { status: 200, requests: "75" },
            { status: 404, requests: "25" },
          ],
          answered: [
            { answered: "store-hit", requests: "60" },
            { answered: "store-miss", requests: "15" },
          ],
          kinds: [
            { kind: "probe", requests: "18", bots: "18" },
            { kind: "", requests: "7", bots: "1" },
          ],
          notFound: [
            { kind: "probe", path: "(probe: env)", requests: "18", bots: "18" },
            // Kept before shapes were: its class.
            { kind: "", path: "/(other)", requests: "6", bots: "1" },
            // Kept before paths were redacted: redacted when shown.
            {
              kind: "",
              path: "/people/someone%40example.com",
              requests: "1",
              bots: "0",
            },
            // A shape no code gives is never shown.
            {
              kind: "guessed",
              path: "/correct-horse-battery",
              requests: "1",
              bots: "0",
            },
          ],
        },
      ),
    ).toBe(
      [
        "allthings_requests, the last 7 days: 100 requests reached the Worker",
        "",
        "status",
        "  200  75 (75.0%)",
        "  404  25 (25.0%)",
        "",
        "answered by (page store hit rate: 80.0%)",
        "  store-hit  60",
        "  store-miss  15",
        "",
        "404s by kind (requests, of them bots)",
        "  18  18  probe",
        "  7  1  (none)",
        "",
        "top 404s (requests, of them bots, kind, path)",
        "  18  18  probe  (probe: env)",
        "  6  1  (none)  /(other)",
        "  1  0  (none)  /people/*",
        "  1  0  guessed  /(other)",
      ].join("\n"),
    );
  });
});
