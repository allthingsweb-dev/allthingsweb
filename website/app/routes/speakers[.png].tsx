import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { getFont } from '~/modules/image-gen/utils.server';
import { fetchSpeakersWithTalks } from '~/modules/speakers/loader.server';
import { SpeakersPreview } from '~/modules/image-gen/templates';
import { getServerTiming } from '~/modules/server-timing.server';

export { headers } from '~/modules/header.server';

export async function loader() {
  const { time, timeSync, getHeaderField } = getServerTiming();
  const speakersWithTalks = await fetchSpeakersWithTalks(time);

  const jsx = <SpeakersPreview speakers={speakersWithTalks} />;

  const svg = await time('satori', satori(jsx, {
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
