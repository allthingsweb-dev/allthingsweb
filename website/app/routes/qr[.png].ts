import { LoaderFunctionArgs } from '@remix-run/node';
import QRCode from 'qrcode';

export { headers } from '~/modules/header.server';

export async function loader({ context }: LoaderFunctionArgs) {
  const { time, getHeaderField } = context.serverTimingsProfiler;
  const websiteUrl = `${context.mainConfig.origin}/`;
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
