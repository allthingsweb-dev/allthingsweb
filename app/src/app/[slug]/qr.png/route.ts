import QRCode from "qrcode";
import { mainConfig } from "@/lib/config";
import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const eventUrl = `${mainConfig.instance.origin}/${slug}`;
  const qrCode = await QRCode.toBuffer(eventUrl, { width: 1200 });

  return new Response(qrCode as BufferSource, {
    headers: {
      "Content-Type": "image/png",
      // QR code for a given slug never changes
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
