import { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { EventPreview } from "@/lib/image-gen/templates";
import { getFont } from "@/lib/image-gen/utils";
import { getPublicEventBySlug } from "@/lib/expanded-events";
import { generatedImageCacheControl } from "@/lib/image-gen/cache";

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

    const event = await getPublicEventBySlug(slug);

    if (!event) {
      return new Response("Event not found", { status: 404 });
    }

    return new ImageResponse(<EventPreview event={event} />, {
      width: 1200,
      height: 630,
      fonts: await getFont("Roboto"),
      headers: {
        "Cache-Control": generatedImageCacheControl,
      },
    });
  } catch (error) {
    console.error("Error generating event preview image:", error);
    return new Response("Error generating image", { status: 500 });
  }
}
