import { env } from '~/modules/env.server';
import { Event } from '~/modules/pocketbase/pocketbase';
import { getEvents } from '~/modules/pocketbase/api.server';
import cachified from '@epic-web/cachified';
import { lru } from '~/modules/cache';

function generateRSS(events: Event[], origin: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
    <channel>
        <title>All Things Web Bay Area events</title>
        <description>Sup! Subscribe to stay up to date with our monthly events.</description>
        <link>${origin}</link>
        <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
        ${events
          .map(
            (event) => `<item>
            <title>${event.name}</title>
            <description>${event.tagline}</description>
            <link>${origin}/${event.slug}</link>
            <pubDate>${event.created.toUTCString()}</pubDate>
        </item>`,
          )
          .join('\n')}
    </channel>
</rss>`;
}

export async function loader() {
  const events = await getEvents();
  const content = await cachified({
    key: 'rss',
    cache: lru,
    ttl: 5 * 60 * 1000, // 5 minute
    getFreshValue: () => generateRSS(events, env.server.origin),
  })
  return new Response(content, {
    headers: {
      'content-type': 'application/rss+xml',
    },
  });
}
