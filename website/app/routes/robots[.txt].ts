import cachified from '@epic-web/cachified';
import { lru } from '~/modules/cache';
import { Event } from '~/domain/contracts/content';
import { LoaderFunctionArgs } from '@remix-run/node';

function generateRobotsTxt(origin: string, events: Event[]) {
  return `User-agent: *
Disallow: /*/cancel
${events
  .filter((event) => !event.enableRegistrations)
  .map((event) => `Disallow: /${event.slug}/register`)
  .join('\n')}
Sitemap: ${origin}/sitemap.xml`;
}

export async function loader({ context }: LoaderFunctionArgs) {
  const { getEvents } = context.services.pocketBaseClient;
  const events = await getEvents();
  const content = await cachified({
    key: 'robots',
    cache: lru,
    ttl: 5 * 60 * 1000, // 5 minute
    getFreshValue: () => generateRobotsTxt(context.mainConfig.origin, events),
  });
  return new Response(content, {
    headers: {
      'content-type': 'text/plain',
    },
  });
}
