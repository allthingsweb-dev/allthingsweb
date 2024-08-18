import { env } from "~/modules/env";
import { Event } from "~/modules/pocketbase/pocketbase";
import { getEvents } from "~/modules/pocketbase/pocketbase.server";

function getUrlElementWithDate(url: string, date: string) {
  return `<url>
        <loc>${url}</loc>
        <lastmod>${date}</lastmod>
        </url>`;
}

function generateSiteMap(events: Event[], origin: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">
            ${events
              .map(
                (event) =>
                  `${getUrlElementWithDate(
                    `${origin}/${event.slug}`,
                    event.updated.toISOString()
                  )}`
              )
              .join("\n")}
            ${events
                .map(
                (event) =>
                    `${getUrlElementWithDate(
                    `${origin}/${event.slug}/register`,
                    event.updated.toISOString()
                    )}`
                )
                .join("\n")}
        </urlset>`;
}

export async function loader() {
  const events = await getEvents();
  return new Response(generateSiteMap(events, env.server.origin), {
    headers: {
      "content-type": "application/xml",
    },
  });
}
