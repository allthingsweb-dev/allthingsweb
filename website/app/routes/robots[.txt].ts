import cachified from '@epic-web/cachified';
import { lru } from '~/modules/cache';
import { env } from '~/modules/env.server';

function generateRobotsTxt(origin: string) {
  return `User-agent: *
Sitemap: ${origin}/sitemap.xml`;
}

export async function loader() {
  const content = await cachified({
    key: 'robots',
    cache: lru,
    ttl: 5 * 60 * 1000, // 5 minute
    getFreshValue: () => generateRobotsTxt(env.server.origin),
  });
  return new Response(content, {
    headers: {
      'content-type': 'text/plain',
    },
  });
}
