import { LoaderFunctionArgs } from '@remix-run/node';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { LandingPagePreview } from '~/modules/image-gen/templates';
import { getFont } from '~/modules/image-gen/utils.server';

export { headers } from '~/modules/header.server';

export async function loader({ context }: LoaderFunctionArgs) {
  const { time, timeSync, getHeaderField } = context.serverTimingsProfiler;
  const pastEvents = await time('getPastEvents', () => context.pocketBaseClient.getPastEvents());
  const eventPhotoIds: string[] = [];
  let loopCounter = 0;
  // Get even number of photos from each event
  while (eventPhotoIds.length < 16) {
    const shuffledPastEvents = pastEvents.toSorted(() => Math.random() - 0.5);
    for (const event of shuffledPastEvents) {
      if (event.photosIds[loopCounter]) {
        eventPhotoIds.push(event.photosIds[loopCounter]);
      }
      if (eventPhotoIds.length >= 16) {
        break;
      }
    }
    loopCounter++;
  }

  const jsx = (
    <LandingPagePreview
      photoIds={eventPhotoIds}
      getPocketbaseUrlForImage={context.pocketBaseClient.getPocketbaseUrlForImage}
    />
  );
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
