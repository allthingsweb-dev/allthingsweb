import QRCode from 'qrcode';
import { env } from '~/modules/env.server.ts';
import { getServerTiming } from '~/modules/server-timing.server.ts';

export { headers } from '~/modules/header.server.ts';

export async function loader() {
  const { time, getHeaderField } = getServerTiming();
  const websiteUrl = `${env.server.origin}/`;
  const qrCode = await time(
    'QRCode.toBuffer',
    QRCode.toBuffer(websiteUrl, { width: 1200 }),
  );
  return new Response(qrCode, {
    headers: {
      'Content-Type': 'image/png',
      // QR code never changes
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Server-Timing': getHeaderField(),
    },
  });
}
