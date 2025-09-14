import QRCode from "qrcode";
import { mainConfig } from "@/lib/config";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const websiteUrl = `${mainConfig.instance.origin}/`;
  const qrCode = await QRCode.toBuffer(websiteUrl, { width: 1200 });

  return new Response(qrCode, {
    headers: {
      "Content-Type": "image/png",
      // QR code never changes
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
