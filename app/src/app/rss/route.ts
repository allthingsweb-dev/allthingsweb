import { NextRequest, NextResponse } from "next/server";
import { getPublishedEvents } from "@/lib/published-events";
import { mainConfig } from "@/lib/config";

function generateRSS(
  events: Awaited<ReturnType<typeof getPublishedEvents>>,
  origin: string,
) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
    <channel>
        <title>All Things Web Bay Area events</title>
        <description>Sup! Subscribe to stay up to date with our monthly events.</description>
        <link>${origin}</link>
        <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
        ${events
          .map(
            (event) => `<item>
            <title>${event.name}</title>
            <description>${event.tagline}</description>
            <link>${origin}/${event.slug}</link>
            <pubDate>${event.createdAt.toUTCString()}</pubDate>
        </item>`,
          )
          .join("\n")}
    </channel>
</rss>`;
}

export async function GET(request: NextRequest) {
  try {
    const events = await getPublishedEvents();
    const content = generateRSS(events, mainConfig.instance.origin);

    return new NextResponse(content, {
      headers: {
        "content-type": "application/rss+xml",
        "cache-control": "public, max-age=300", // Cache for 5 minutes
      },
    });
  } catch (error) {
    console.error("Error generating RSS feed:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
