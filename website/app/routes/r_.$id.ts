import cachified from '@epic-web/cachified';
import { LoaderFunctionArgs, redirect } from '@remix-run/node';
import { lru } from '~/modules/cache';
import { notFound } from '~/modules/responses.server';

export async function loader({ params, context }: LoaderFunctionArgs) {
  const id = params.id;
  if (!id) {
    throw new Error('No id provided');
  }
  const link = await cachified({
    key: `getLink-${id}`,
    ttl: 3 * 60 * 1000, // 3 minutes
    cache: lru,
    getFreshValue() {
      return context.pocketBaseClient.getLink(id);
    },
  });
  if (!link) {
    return notFound();
  }
  // Redirect to the destination URL (moved permanently for SEO authority)
  return redirect(link.destinationUrl, { status: 301 });
}
