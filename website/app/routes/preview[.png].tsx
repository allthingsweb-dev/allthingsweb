import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { LandingPagePreview } from '~/modules/image-gen/templates';
import { getFont } from '~/modules/image-gen/utils.server';
import { getPastEvents } from '~/modules/pocketbase/api.server';

export async function loader() {
  const pastEvents = await getPastEvents();
  const photoIds = pastEvents
    .flatMap((event) => event.photosIds)
    .sort(() => 0.5 - Math.random())
    .slice(0, 40);

  const jsx = <LandingPagePreview photoIds={photoIds} />;
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
