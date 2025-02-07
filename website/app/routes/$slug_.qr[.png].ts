import { LoaderFunctionArgs } from 'react-router';
import QRCode from 'qrcode';

export { headers } from '~/modules/header.server';

export async function loader({ params, context }: LoaderFunctionArgs) {
  const { time, getHeaderField } = context.serverTimingsProfiler;
  if (!params.slug) {
    throw new Error('No slug provided');
  }
  const eventUrl = `${context.mainConfig.origin}/${params.slug}`;
  const qrCode = await time('QRCode.toBuffer', QRCode.toBuffer(eventUrl, { width: 1200 }));
  return new Response(qrCode, {
    headers: {
      'Content-Type': 'image/png',
      // QR code for a given slug never changes
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Server-Timing': getHeaderField(),
    },
  });
}
