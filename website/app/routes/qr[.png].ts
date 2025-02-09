import QRCode from "qrcode";
import { Route } from "./+types/qr[.png]";

export { headers } from "~/modules/header.server";

export async function loader({ context }: Route.LoaderArgs) {
  const { time, getHeaderField } = context.serverTimingsProfiler;
  const websiteUrl = `${context.mainConfig.origin}/`;
  const qrCode = await time(
    "QRCode.toBuffer",
    QRCode.toBuffer(websiteUrl, { width: 1200 }),
  );
  return new Response(qrCode, {
    headers: {
      "Content-Type": "image/png",
      // QR code never changes
      "Cache-Control": "public, max-age=31536000, immutable",
      "Server-Timing": getHeaderField(),
    },
  });
}
