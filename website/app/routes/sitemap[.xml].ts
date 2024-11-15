import { Event } from '~/domain/contracts/content';
import { lru } from '~/modules/cache';
import cachified from '@epic-web/cachified';
import { LoaderFunctionArgs } from '@remix-run/node';

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
            ${events
              .filter((event) => event.enableRegistrations)
              .map(
                (event) => `${getUrlElementWithDate(`${origin}/${event.slug}/register`, event.updated.toISOString())}`,
              )
              .join('\n')}
        </urlset>`;
}

export async function loader({ context }: LoaderFunctionArgs) {
  const { getEvents } = context.services.pocketBaseClient;
  const events = await getEvents();
  const content = await cachified({
    key: 'sitemap',
    cache: lru,
    ttl: 5 * 60 * 1000, // 5 minute
    getFreshValue: () => generateSiteMap(events, context.mainConfig.origin),
  });
  return new Response(content, {
    headers: {
      'content-type': 'application/xml',
    },
  });
}
