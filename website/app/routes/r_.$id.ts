import { cachified } from '@epic-web/cachified';
import { LoaderFunctionArgs, redirect } from '@remix-run/server-runtime';
import { lru } from '~/modules/cache.ts';
import { getLink } from '~/modules/pocketbase/api.server.ts';
import { notFound } from '~/modules/responses.server.ts';

export async function loader({ params }: LoaderFunctionArgs) {
  const id = params.id;
  if (!id) {
    throw new Error('No id provided');
  }
  const link = await cachified({
    key: `getLink-${id}`,
    ttl: 3 * 60 * 1000, // 3 minutes
    cache: lru,
    getFreshValue() {
      return getLink(id);
    },
  });
  if (!link) {
    return notFound();
  }
  // Redirect to the destination URL (moved permanently for SEO authority)
  return redirect(link.destinationUrl, { status: 301 });
}
