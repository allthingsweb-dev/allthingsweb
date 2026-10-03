import { NextResponse } from "next/server";
import { mainConfig } from "@/lib/config";
import { generateRobotsTxt } from "@/lib/robots";

export function GET() {
  return new NextResponse(generateRobotsTxt(mainConfig.instance.origin), {
    headers: {
      "content-type": "text/plain",
      "cache-control": "public, max-age=300", // Cache for 5 minutes
    },
  });
}
