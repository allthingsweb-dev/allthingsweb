import { LoaderFunctionArgs } from '@remix-run/node';
import { env } from '~/modules/env.server';
import QRCode from 'qrcode';

export async function loader({ params }: LoaderFunctionArgs) {
  if (!params.slug) {
    throw new Error('No slug provided');
  }
  const eventUrl = `${env.server.origin}/${params.slug}`;
  const qrCode = await QRCode.toBuffer(eventUrl, { width: 1200 });
  return new Response(qrCode, {
    headers: {
      'Content-Type': 'image/png',
      // QR code for a given slug never changes
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
