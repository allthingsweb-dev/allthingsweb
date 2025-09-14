import { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { LandingPagePreview } from "@/lib/image-gen/templates";
import { getFont } from "@/lib/image-gen/utils";
import { getPastEventImages } from "@/lib/images";

export async function GET(request: NextRequest) {
  try {
    // Get past event images
    const pastEventImages = await getPastEventImages();

    // Resize images for the preview (similar to the original implementation)
    const resizedImages = pastEventImages.map((image) => {
      const search = new URLSearchParams();
      search.set("w", "300");
      search.set("h", "315");
      search.set("src", image.url);
      return {
        ...image,
        // For Next.js, we'll use the original URL since Next.js handles optimization
        url: image.url,
      };
    });

    return new ImageResponse(<LandingPagePreview images={resizedImages} />, {
      width: 1200,
      height: 630,
      fonts: await getFont("Roboto"),
      headers: {
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
      },
    });
  } catch (error) {
    console.error("Error generating preview image:", error);
    return new Response("Error generating image", { status: 500 });
  }
}
