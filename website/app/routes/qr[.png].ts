import { env } from '~/modules/env.server';
import QRCode from 'qrcode';
import { getServerTiming } from '~/modules/server-timing.server';

export { headers } from '~/modules/header.server';

export async function loader() {
  const { time, getHeaderField } = getServerTiming();
  const websiteUrl = `${env.server.origin}/`;
  const qrCode = await time('QRCode.toBuffer', QRCode.toBuffer(websiteUrl, { width: 1200 }));
  return new Response(qrCode, {
    headers: {
      'Content-Type': 'image/png',
      // QR code never changes
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Server-Timing': getHeaderField(),
    },
  });
}
