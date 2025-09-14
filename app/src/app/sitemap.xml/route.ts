import { NextRequest, NextResponse } from "next/server";
import { getPublishedEvents } from "@/lib/published-events";
import { mainConfig } from "@/lib/config";

function getUrlElementWithDate(url: string, date: string) {
  return `<url>
        <loc>${url}</loc>
        <lastmod>${date}</lastmod>
        </url>`;
}

function generateSiteMap(
  events: Awaited<ReturnType<typeof getPublishedEvents>>,
  origin: string,
) {
  return `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">
            ${getUrlElementWithDate(`${origin}/`, new Date().toISOString())}
            ${getUrlElementWithDate(`${origin}/speakers`, new Date().toISOString())}
            ${getUrlElementWithDate(`${origin}/about`, new Date().toISOString())}
            ${events
              .map(
                (event) =>
                  `${getUrlElementWithDate(`${origin}/${event.slug}`, event.updatedAt.toISOString())}`,
              )
              .join("\n")}
        </urlset>`;
}

export async function GET(request: NextRequest) {
  try {
    const events = await getPublishedEvents();
    const content = generateSiteMap(events, mainConfig.instance.origin);

    return new NextResponse(content, {
      headers: {
        "content-type": "application/xml",
        "cache-control": "public, max-age=300", // Cache for 5 minutes
      },
    });
  } catch (error) {
    console.error("Error generating sitemap:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
