import { env } from '~/modules/env.server';
import { Event } from '~/modules/pocketbase/pocketbase';
import { getEvents } from '~/modules/pocketbase/api.server';
import { lru } from '~/modules/cache';
import cachified from '@epic-web/cachified';

function getUrlElementWithDate(url: string, date: string) {
  return `<url>
        <loc>${url}</loc>
        <lastmod>${date}</lastmod>
        </url>`;
}

function generateSiteMap(events: Event[], origin: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="https://www.sitemaps.org/schemas/sitemap/0.9">
            ${getUrlElementWithDate(`${origin}/`, new Date().toISOString())}
            ${getUrlElementWithDate(`${origin}/speakers`, new Date().toISOString())}
            ${events
              .map((event) => `${getUrlElementWithDate(`${origin}/${event.slug}`, event.updated.toISOString())}`)
              .join('\n')}
        </urlset>`;
}

export async function loader() {
  const events = await getEvents();
  const content = await cachified({
    key: 'sitemap',
    cache: lru,
    ttl: 5 * 60 * 1000, // 5 minute
    getFreshValue: () => generateSiteMap(events, env.server.origin),
  });
  return new Response(content, {
    headers: {
      'content-type': 'application/xml',
    },
  });
}
