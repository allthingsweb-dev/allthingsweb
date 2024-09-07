import { env } from '~/modules/env.server';

function generateRobotsTxt(origin: string) {
  return `User-agent: *
Disallow: /*/cancel
Sitemap: ${origin}/sitemap.xml`;
}

export async function loader() {
  return new Response(generateRobotsTxt(env.server.origin), {
    headers: {
      'content-type': 'text/plain',
    },
  });
}
