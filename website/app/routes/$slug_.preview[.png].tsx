import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { LoaderFunctionArgs, redirect } from '@remix-run/node';
import { getFont } from '~/modules/image-gen/utils.server';
import { EventPreview } from '~/modules/image-gen/templates';
import { getExpandedEventBySlug } from '~/modules/pocketbase/api.server';
import { env } from '~/modules/env.server';
import { notFound } from '~/modules/responses.server';
import { getServerTiming } from '~/modules/server-timing.server';

export { headers } from '~/modules/header.server';

export async function loader({ params }: LoaderFunctionArgs) {
  const { time, timeSync, getHeaderField } = getServerTiming();
  const { slug } = params;
  if (typeof slug !== 'string') {
    throw notFound();
  }
  const event = await time('getExpandedEventBySlug', () => getExpandedEventBySlug(slug));
  if (!event) {
    throw notFound();
  }

  if (event.previewImageId) {
    // If the event has a image associated on PocketBase, redirect to the image URL
    return redirect(event.previewImageUrl, {
      status: 302,
      statusText: 'Found',
    });
  }

  const jsx = <EventPreview event={event} serverOrigin={env.server.origin} />;

  const svg = await time('satori', async () =>
    satori(jsx, {
      width: 1200,
      height: 1200,
      fonts: await getFont('Roboto'),
    }),
  );
  const resvg = new Resvg(svg);
  const pngData = timeSync('resvg.render', () => resvg.render());
  const data = timeSync('asPng', () => pngData.asPng());
  return new Response(data, {
    headers: {
      'Content-Type': 'image/png',
      'Server-Timing': getHeaderField(),
    },
  });
}
