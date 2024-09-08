import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { LoaderFunctionArgs } from '@remix-run/node';
import { getFont } from '~/modules/image-gen/utils.server';
import { EventPreview } from '~/modules/image-gen/templates';
import { getExpandedEventBySlug } from '~/modules/pocketbase/api.server';
import { env } from '~/modules/env.server';
import { notFound } from '~/modules/responses.server';

export async function loader({ params }: LoaderFunctionArgs) {
  const { slug } = params;
  if (typeof slug !== 'string') {
    throw notFound();
  }
  const event = await getExpandedEventBySlug(slug);
  if (!event) {
    throw notFound();
  }

  const jsx = <EventPreview event={event} serverOrigin={env.server.origin} />;

  const svg = await satori(jsx, {
    width: 1200,
    height: 1200,
    fonts: await getFont('Roboto'),
  });
  const resvg = new Resvg(svg);
  const pngData = resvg.render();
  const data = pngData.asPng();
  return new Response(data, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': `public, max-age=${event.start < new Date() ? 60 * 60 * 24 * 7 : 60 * 60 * 24}`,
    },
  });
}
