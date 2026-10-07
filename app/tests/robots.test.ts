import { describe, expect, test } from "bun:test";
import { generateRobotsTxt } from "../src/lib/robots";

describe("robots.txt", () => {
  const robots = generateRobotsTxt("https://allthingsweb.dev");

  test("keeps private and operational paths out of search", () => {
    for (const path of ["/api/cron"]) {
      expect(robots).toContain(`Disallow: ${path}\n`);
    }
  });

  test("leaves public pages and generated images crawlable", () => {
    expect(robots).toContain("Allow: /\n");
    expect(robots).not.toMatch(/Disallow: \/api\/v1\n/);
    expect(robots).not.toMatch(/Disallow: \/speakers/);
  });

  test("points crawlers at the sitemap on the public origin", () => {
    expect(robots).toContain("Sitemap: https://allthingsweb.dev/sitemap.xml");
  });
});
