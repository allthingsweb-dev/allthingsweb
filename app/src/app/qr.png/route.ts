import QRCode from "qrcode";
import { mainConfig } from "@/lib/config";

export async function GET() {
  const websiteUrl = `${mainConfig.instance.origin}/`;
  const qrCode = await QRCode.toBuffer(websiteUrl, { width: 1200 });
  const buffer = Buffer.from(qrCode);

  return new Response(buffer, {
    headers: {
      "Content-Type": "image/png",
      // QR code never changes
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
