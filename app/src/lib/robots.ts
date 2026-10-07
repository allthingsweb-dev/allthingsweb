/** Private or operational paths that should never appear in search results. */
const disallowedPaths = [
  "/sentry-example-page",
  "/api/cron",
  "/api/sentry-example-api",
];

export function generateRobotsTxt(origin: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    ...disallowedPaths.map((path) => `Disallow: ${path}`),
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}
