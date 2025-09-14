import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  // Permanent redirect to the canonical RSS feed URL
  return NextResponse.redirect(new URL("/rss", request.url), 301);
}
