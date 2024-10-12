import { cachified } from '@epic-web/cachified';
import { lru } from '~/modules/cache.ts';
import { env } from '~/modules/env.server.ts';
import { getEvents } from '~/modules/pocketbase/api.server.ts';
import { Event } from '~/modules/pocketbase/pocketbase.ts';

function generateRobotsTxt(origin: string, events: Event[]) {
  return `User-agent: *
Disallow: /*/cancel
${
    events
      .filter((event) => !event.enableRegistrations)
      .map((event) => `Disallow: /${event.slug}/register`)
      .join('\n')
  }
Sitemap: ${origin}/sitemap.xml`;
}

export async function loader() {
  const events = await getEvents();
  const content = await cachified({
    key: 'robots',
    cache: lru,
    ttl: 5 * 60 * 1000, // 5 minute
    getFreshValue: () => generateRobotsTxt(env.server.origin, events),
  });
  return new Response(content, {
    headers: {
      'content-type': 'text/plain',
    },
  });
}
