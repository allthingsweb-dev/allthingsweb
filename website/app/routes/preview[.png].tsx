import cachified from '@epic-web/cachified';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { lru } from '~/modules/image-gen/cache';
import { LandingPagePreview } from '~/modules/image-gen/templates';
import { getFont } from '~/modules/image-gen/utils.server';
import { getPastEvents } from '~/modules/pocketbase/api.server';

export async function loader() {
  const variants = [1, 2, 3, 4];
  const randomVariant = variants[Math.floor(Math.random() * variants.length)];
  const buffer = await cachified({
    key: `landing-page-preview-${randomVariant}`,
    cache: lru,
    async getFreshValue() {
      const pastEvents = await getPastEvents();
      const photos = pastEvents
        .flatMap((event) => event.photos)
        .sort(() => 0.5 - Math.random())
        .slice(0, 40);

      const jsx = <LandingPagePreview images={photos} />;
      const svg = await satori(jsx, {
        width: 1200,
        height: 1200,
        fonts: await getFont('Roboto'),
      });
      const resvg = new Resvg(svg);
      const pngData = resvg.render();
      return pngData.asPng();
    },
    // 2 hours in milliseconds
    ttl: 2 * 60 * 60 * 1000,
    // 24 hours in milliseconds
    staleWhileRevalidate: 24 * 60 * 60 * 1000,
  });

  return new Response(buffer, {
    headers: {
      'Content-Type': 'image/png',
      // 2 hours in seconds
      'Cache-Control': `public, max-age=${60 * 60 * 2}`,
    },
  });
}
