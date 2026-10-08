import { describe, expect } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import { eventDatabase, slugs } from "./support/event-catalog.ts";
import { serve } from "./support/socket.ts";
import { testStack } from "./support/stack.ts";

/**
 * The draft preview as it deploys: its own Worker, bundled as
 * infra/src/preview.ts bundles it and run in workerd beside the site.
 * Without what Access signs it shows nothing; tests/preview.test.ts checks
 * a signed token's way through. The site beside it never shows the draft.
 */

const database = await serve(await eventDatabase(new Date()));

const Stack = testStack("allthings-web-preview-test", {
  Preview: {
    entry: "preview",
    ORIGIN: "https://allthings.dev",
    DATABASE_URL: database.url,
    PUBLIC_URL: "https://site.example",
    ACCESS_TEAM_DOMAIN: "allthings-test.cloudflareaccess.com",
    ACCESS_AUD: "preview-audience",
    PREVIEW_VIEWERS: "erik@example.com",
  },
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

const it = (
  name: string,
  run: (urls: { Preview: string; Site: string }) => Promise<void>,
) =>
  test(
    name,
    Effect.flatMap(workers, (outputs) =>
      Effect.promise(() =>
        run({
          Preview: String(outputs["Preview"]),
          Site: String(outputs["Site"]),
        }),
      ),
    ),
  );

describe("the preview Worker", () => {
  it("refuses a request Access didn't sign, before reading anything", async ({
    Preview,
  }) => {
    for (const path of ["/", `/${slugs.draft}`, "/img/x"]) {
      for (const headers of [{}, { "cf-access-jwt-assertion": "not.a.jwt" }]) {
        const response = await fetch(`${Preview}${path}`, {
          headers,
          redirect: "manual",
        });
        expect(response.status).toBe(403);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
        expect(await response.text()).toBe(
          "Only the organizers and the people they invite can see drafts.",
        );
      }
    }
  });

  it("leaves the draft off the site", async ({ Site }) => {
    const response = await fetch(`${Site}/${slugs.draft}`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("All Things Draft");
  });
});
