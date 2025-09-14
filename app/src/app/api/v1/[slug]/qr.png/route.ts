import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { getExpandedEventBySlug } from "@/lib/expanded-events";
import { mainConfig } from "@/lib/config";

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

    // Generate QR code for the event's Luma URL or fallback to event page
    const qrUrl = event.lumaEventUrl || `${mainConfig.instance.origin}/${slug}`;

    const qrBuffer = await QRCode.toBuffer(qrUrl, {
      type: "png",
      width: 512,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    });

    return new Response(qrBuffer as BufferSource, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable", // Cache for 1 year, immutable
      },
    });
  } catch (error) {
    console.error("Error generating event QR code:", error);
    return new Response("Error generating QR code", { status: 500 });
  }
}
