import { describe, expect } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { seededDatabase } from "allthings-core/tests/support/database.ts";
import * as Effect from "effect/Effect";
import { proposePath, trapField } from "../src/pages/propose.tsx";
import { outcomeMessages } from "../src/proposals.ts";
import { serve } from "./support/socket.ts";
import { hyperdriveTo, testStack } from "./support/stack.ts";

/**
 * /propose (src/pages/propose.tsx), served by the Worker in workerd: the
 * page, and its form sent without a script, kept in PGlite over TCP as
 * prod keeps them through `INTAKE`. Open has the intake, Closed is every
 * other stage.
 */

const origin = "https://allthings.dev";
const db = await seededDatabase();
const database = await serve(db);

const Stack = testStack("allthings-web-propose-test", {
  Open: {
    ORIGIN: origin,
    DATABASE_URL: database.url,
    INTAKE: hyperdriveTo(database.url),
    PROPOSALS_LIMIT: 50,
  },
  Closed: { ORIGIN: origin, DATABASE_URL: database.url },
});

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});
const workers = beforeAll(deploy(Stack));
afterAll(
  destroy(Stack).pipe(Effect.ensuring(Effect.promise(() => database.stop()))),
);

type Worker = "Open" | "Closed";

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
        return run({ Open: url("Open"), Closed: url("Closed") });
      }),
    ),
  );

const fields = {
  title: "Effect in production",
  format: "demo",
  abstract:
    "What a year of Effect in a payments service taught us about errors.",
  name: "Ada Lovelace",
  email: "ada@example.com",
  about: "",
  links: "https://github.com/ada\r\n\r\nhttps://ada.example\r\n",
  notes: "",
  [trapField]: "",
};

/** Sends the form to `base` as a browser on its page does, with `headers` over that. */
const send = (
  base: string,
  form: Record<string, string>,
  headers: Record<string, string> = { origin: base },
) =>
  fetch(`${base}${proposePath}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(form).toString(),
  });

const kept = async () =>
  (
    await db.query<{
      title: string;
      format: string;
      links: Array<string>;
      source: string;
    }>(
      `SELECT title, format, links, source FROM planning.proposals ORDER BY created_at, title`,
    )
  ).rows;

describe("/propose", () => {
  it("is a form that posts here and nowhere else, with no script", async ({
    Open,
  }) => {
    const response = await fetch(`${Open}${proposePath}`);
    expect(response.status).toBe(200);
    const policy = response.headers.get("content-security-policy") ?? "";
    expect(policy).toContain("form-action 'self'");
    expect(policy).not.toContain("script-src");
    const html = await response.text();
    expect(html).toContain(
      '<form class="form" method="post" action="/propose">',
    );
    for (const name of [
      "title",
      "abstract",
      "name",
      "email",
      "links",
      "notes",
    ]) {
      expect(html).toContain(`name="${name}"`);
    }
    // The trap is hidden from people, and out of the tab order.
    expect(html).toMatch(/<div class="propose-trap" hidden>/);
    expect(html).not.toContain("<script");
  });

  it("keeps a proposal sent from its page, as the site's, its links one a line", async ({
    Open,
  }) => {
    const response = await send(Open, fields);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain(outcomeMessages.Kept.replace("'", "&#39;"));
    expect(html).not.toContain("<form");
    expect(await kept()).toEqual([
      {
        title: "Effect in production",
        format: "demo",
        links: ["https://github.com/ada", "https://ada.example"],
        source: "site",
      },
    ]);
  });

  it("gives the form back as it was sent, each problem by its field, and keeps nothing", async ({
    Open,
  }) => {
    const before = (await kept()).length;
    const response = await send(Open, {
      ...fields,
      title: `"><img src=x onerror=alert(1)>`,
      abstract: "</textarea><script>alert(1)</script>",
      email: "nope",
    });
    expect(response.status).toBe(422);
    const html = await response.text();
    // What was sent comes back as text: out of the attribute, out of the textarea.
    expect(html).toContain(`value="&#34;><img src=x onerror=alert(1)>"`);
    expect(html).not.toContain("</textarea><script>");
    expect(html).toContain(
      "&lt;/textarea>&lt;script>alert(1)&lt;/script></textarea>",
    );
    expect(html).toContain('aria-describedby="abstract-problem"');
    expect(html).toContain("say a little more, at least 40");
    expect(html).toContain('aria-describedby="email-problem"');
    expect(html).toMatch(/<option value="demo" selected/);
    expect((await kept()).length).toBe(before);
  });

  it("thanks a script that fills the trap, and keeps nothing", async ({
    Open,
  }) => {
    const before = (await kept()).length;
    const response = await send(Open, {
      ...fields,
      title: "Spam",
      [trapField]: "https://spam.example",
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      outcomeMessages.Kept.replace("'", "&#39;"),
    );
    expect((await kept()).length).toBe(before);
  });

  it("refuses a form sent from another site", async ({ Open }) => {
    const before = (await kept()).length;
    for (const headers of [
      { origin: "https://elsewhere.example" },
      { "sec-fetch-site": "cross-site" },
      {},
    ]) {
      const response = await send(
        Open,
        { ...fields, title: "From elsewhere" },
        headers,
      );
      expect(response.status).toBe(403);
    }
    expect((await kept()).length).toBe(before);
  });

  it("says a stage without the intake doesn't take proposals, and gives the form back", async ({
    Closed,
  }) => {
    const response = await send(Closed, { ...fields, title: "Nowhere" });
    expect(response.status).toBe(503);
    const html = await response.text();
    expect(html).toContain("doesn&#39;t take proposals");
    expect(html).toContain('value="Nowhere"');
  });
});
