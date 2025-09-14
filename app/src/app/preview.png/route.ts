import { NextRequest } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export async function GET(request: NextRequest) {
  // For now, just serve a static preview image from public folder
  // Later we can add satori/resvg for dynamic generation
  try {
    const imagePath = join(process.cwd(), "public", "hero-image-rocket.png");
    const imageBuffer = readFileSync(imagePath);

    return new Response(imageBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600", // 1 hour cache
      },
    });
  } catch (error) {
    // Fallback to a simple text response if image not found
    return new Response("Preview image not available", { status: 404 });
  }
}
