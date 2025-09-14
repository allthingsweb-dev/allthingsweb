import { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { EventYouTubeThumbnail } from "@/lib/image-gen/templates";
import { getFont } from "@/lib/image-gen/utils";
import { getExpandedEventBySlug } from "@/lib/expanded-events";

type Params = {
  slug: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Params> },
) {
  try {
    const { slug } = await params;

    if (!slug || typeof slug !== "string") {
      return new Response("Invalid slug", { status: 400 });
    }

    const event = await getExpandedEventBySlug(slug);

    if (!event) {
      return new Response("Event not found", { status: 404 });
    }

    return new ImageResponse(<EventYouTubeThumbnail event={event} />, {
      width: 1280,
      height: 720,
      fonts: await getFont("Roboto"),
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable", // Cache for 1 year, immutable
      },
    });
  } catch (error) {
    console.error("Error generating YouTube thumbnail:", error);
    return new Response("Error generating image", { status: 500 });
  }
}
