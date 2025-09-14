import { NextRequest } from "next/server";
import QRCode from "qrcode";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");

    if (!url) {
      return new Response("URL parameter is required", { status: 400 });
    }

    // Generate QR code as PNG buffer
    const qrBuffer = await QRCode.toBuffer(url, {
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
    console.error("Error generating QR code:", error);
    return new Response("Error generating QR code", { status: 500 });
  }
}
