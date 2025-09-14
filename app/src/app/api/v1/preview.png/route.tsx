import { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { LandingPagePreview } from "@/lib/image-gen/templates";
import { getFont } from "@/lib/image-gen/utils";
import { getPastEventImages } from "@/lib/images";

export async function GET(request: NextRequest) {
  try {
    // Get past event images
    const pastEventImages = await getPastEventImages();

    // Use high resolution images for great quality in the social preview
    // Each image will be 400x315 for high quality with 6 images (3 per row, 2 rows)
    const resizedImages = pastEventImages.map((image) => {
      const search = new URLSearchParams();
      search.set("w", "400");
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
        "Cache-Control": "public, max-age=31536000, immutable", // Cache for 1 year, immutable
      },
    });
  } catch (error) {
    console.error("Error generating preview image:", error);
    return new Response("Error generating image", { status: 500 });
  }
}
