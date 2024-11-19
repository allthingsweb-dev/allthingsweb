import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { getFont } from '~/modules/image-gen/utils.server';
import { fetchSpeakersWithTalks } from '~/modules/speakers/loader.server';
import { SpeakersPreview } from '~/modules/image-gen/templates';
import { LoaderFunctionArgs } from '@remix-run/node';

export { headers } from '~/modules/header.server';

export async function loader({ context }: LoaderFunctionArgs) {
  const { time, timeSync, getHeaderField } = context.serverTimingsProfiler;
  const speakersWithTalks = await fetchSpeakersWithTalks({
    pocketBaseClient: context.pocketBaseClient,
    serverTimingsProfiler: context.serverTimingsProfiler,
  });

  const jsx = (
    <SpeakersPreview
      speakers={speakersWithTalks}
      getPocketbaseUrlForImage={context.pocketBaseClient.getPocketbaseUrlForImage}
    />
  );

  const svg = await time(
    'satori',
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
