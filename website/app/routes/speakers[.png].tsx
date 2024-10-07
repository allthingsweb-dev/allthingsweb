import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { getFont } from '~/modules/image-gen/utils.server';
import { speakersLoader } from '~/modules/speakers/loader.server';
import { SpeakersPreview } from '~/modules/image-gen/templates';

export async function loader() {
  const { speakersWithTalks } = await speakersLoader();

  const jsx = <SpeakersPreview speakers={speakersWithTalks} />;

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
    },
  });
}
