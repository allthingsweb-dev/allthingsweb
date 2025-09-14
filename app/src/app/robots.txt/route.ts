import { NextRequest, NextResponse } from "next/server";
import { mainConfig } from "@/lib/config";

function generateRobotsTxt(origin: string) {
  return `User-agent: *
Sitemap: ${origin}/sitemap.xml`;
}

export async function GET(request: NextRequest) {
  try {
    const content = generateRobotsTxt(mainConfig.instance.origin);

    return new NextResponse(content, {
      headers: {
        "content-type": "text/plain",
        "cache-control": "public, max-age=300", // Cache for 5 minutes
      },
    });
  } catch (error) {
    console.error("Error generating robots.txt:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
