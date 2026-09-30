import { NextResponse } from "next/server";
import { getPublishedEvents } from "@/lib/published-events";
import { generateSiteMap } from "@/lib/event-feeds";

export async function GET() {
  try {
    const events = await getPublishedEvents();
    const content = generateSiteMap(events);

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
