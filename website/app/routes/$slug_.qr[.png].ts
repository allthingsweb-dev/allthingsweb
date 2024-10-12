import { LoaderFunctionArgs } from '@remix-run/node';
import QRCode from 'qrcode';
import { env } from '~/modules/env.server.ts';
import { getServerTiming } from '~/modules/server-timing.server.ts';

export { headers } from '~/modules/header.server.ts';

export async function loader({ params }: LoaderFunctionArgs) {
  if (!params.slug) {
    throw new Error('No slug provided');
  }
  const { time, getHeaderField } = getServerTiming();
  const eventUrl = `${env.server.origin}/${params.slug}`;
  const qrCode = await time(
    'QRCode.toBuffer',
    QRCode.toBuffer(eventUrl, { width: 1200 }),
  );
  return new Response(qrCode, {
    headers: {
      'Content-Type': 'image/png',
      // QR code for a given slug never changes
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Server-Timing': getHeaderField(),
    },
  });
}
