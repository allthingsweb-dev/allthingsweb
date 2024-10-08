import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { LandingPagePreview } from '~/modules/image-gen/templates';
import { getFont } from '~/modules/image-gen/utils.server';
import { getPastEvents } from '~/modules/pocketbase/api.server';

export async function loader() {
  const pastEvents = await getPastEvents();
  let eventPhotoIds: string[] = [];
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
  const svg = await satori(jsx, {
    width: 1200,
    height: 1200,
    fonts: await getFont('Roboto'),
  });
  const resvg = new Resvg(svg);
  const pngData = resvg.render();

  return new Response(pngData.asPng(), {
    headers: {
      'Content-Type': 'image/png',
    },
  });
}
