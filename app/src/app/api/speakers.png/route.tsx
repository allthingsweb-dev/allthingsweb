import { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { SpeakersPreview } from "@/lib/image-gen/templates";
import { getFont } from "@/lib/image-gen/utils";
import { getSpeakersWithTalks } from "@/lib/speakers";

export async function GET(request: NextRequest) {
  try {
    const { speakers } = await getSpeakersWithTalks();

    return new ImageResponse(<SpeakersPreview speakers={speakers} />, {
      width: 1200,
      height: 630,
      fonts: await getFont("Roboto"),
      headers: {
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
      },
    });
  } catch (error) {
    console.error("Error generating speakers preview image:", error);
    return new Response("Error generating image", { status: 500 });
  }
}
