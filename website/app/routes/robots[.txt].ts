import { env } from '~/modules/env.server';
import { getEvents } from '~/modules/pocketbase/api.server';
import { Event } from '~/modules/pocketbase/pocketbase';

function generateRobotsTxt(origin: string, events: Event[]) {
  return `User-agent: *
Disallow: /*/cancel
${events
  .filter((event) => !event.enableRegistrations)
  .map((event) => `Disallow: /${event.slug}/register`)
  .join('\n')}
Sitemap: ${origin}/sitemap.xml`;
}

export async function loader() {
  const events = await getEvents();
  return new Response(generateRobotsTxt(env.server.origin, events), {
    headers: {
      'content-type': 'text/plain',
    },
  });
}
