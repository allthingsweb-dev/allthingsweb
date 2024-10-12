import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { LandingPagePreview } from '~/modules/image-gen/templates.tsx';
import { getFont } from '~/modules/image-gen/utils.server.ts';
import { getPastEvents } from '~/modules/pocketbase/api.server.ts';
import { getServerTiming } from '~/modules/server-timing.server.ts';

export { headers } from '~/modules/header.server.ts';

export async function loader() {
  const { time, timeSync, getHeaderField } = getServerTiming();
  const pastEvents = await time('getPastEvents', () => getPastEvents());
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

  const jsx = <LandingPagePreview photoIds={eventPhotoIds} />;
  const svg = await time('satori', async () =>
    satori(jsx, {
      width: 1200,
      height: 1200,
      fonts: await getFont('Roboto'),
    }));
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
