import { describe, expect, test } from "bun:test";
import type { PersonPage } from "allthings-core/src/people-directory.ts";
import { personSlug } from "allthings-core/src/person-slug.ts";
import type { XPosts } from "allthings-core/src/x-posts.ts";
import { personPage } from "../src/pages/person.tsx";
import { htmlProblems } from "./support/pages.ts";

/**
 * Someone's standout posts on X on their page (core/src/x-posts.ts), as a
 * pure function of fixed data: after the bio, each post a link with its
 * day, a short quote and its counts, under the month they were read.
 */

const record: XPosts = {
  posts: [
    {
      url: "https://x.com/Ada_L/status/2000000000000000002",
      postedOn: "2026-10-09",
      excerpt: "How do <always-on> agents work? Watch my lecture",
      likes: 4711,
      reposts: 472,
      replies: 193,
    },
    {
      url: "https://x.com/Ada_L/status/2000000000000000001",
      postedOn: "2026-09-21",
      excerpt: "One like.",
      likes: 1,
      reposts: 1,
      replies: 0,
    },
  ],
  readOn: "2026-11-05",
};

const person = (overrides: Partial<PersonPage> = {}): PersonPage => ({
  id: "ada",
  slug: personSlug("Ada"),
  name: "Ada",
  title: "Engineer",
  bio: "Writes compilers.",
  links: { x: "https://x.com/Ada_L", bluesky: null, linkedin: null },
  photo: null,
  parts: [],
  organizes: false,
  hosted: [],
  now: null,
  xPosts: record,
  ...overrides,
});

const render = (who: PersonPage) =>
  personPage({
    person: who,
    elsewhere: [],
    origin: "https://allthings.dev",
    theme: undefined,
    portraits: new Map(),
    images: "originals",
  });

const section = (html: string): string =>
  /<section class="about-part" aria-labelledby="on-x">[\s\S]*?<\/section>/.exec(
    html,
  )?.[0] ?? "";

describe("the On X section", () => {
  test("follows the bio and says the month the posts were read", async () => {
    const html = render(person());
    expect(await htmlProblems(html)).toEqual([]);
    expect(html.indexOf('aria-labelledby="bio"')).toBeLessThan(
      html.indexOf('aria-labelledby="on-x"'),
    );
    expect(section(html)).toContain(
      '<h2 id="on-x" class="at-type-meta">On X · as of 2026.11</h2>',
    );
  });

  test("links each post with its day, a short quote, its author and its counts, latest first", () => {
    const posts = section(render(person()));
    expect(posts).toContain(
      '<li><a class="talk" href="https://x.com/Ada_L/status/2000000000000000002"><time class="date at-type-meta" datetime="2026-10-09">2026.10.09</time><span class="talk-title">“How do &lt;always-on&gt; agents work? Watch my lecture”</span><span class="talk-evening"><span>@Ada_L</span><span class="talk-role at-type-meta"> · 4.7k likes · 472 reposts</span></span></a></li>',
    );
    expect(posts).toContain(" · 1 like · 1 repost</span>");
    expect(posts.indexOf("2000000000000000002")).toBeLessThan(
      posts.indexOf("2000000000000000001"),
    );
  });

  test("is left out for someone without posts", () => {
    expect(render(person({ xPosts: null }))).not.toContain('id="on-x"');
  });
});
