import { LoaderFunctionArgs, redirect } from '@remix-run/node';
import { getLink } from '~/modules/pocketbase/api.server';
import { notFound } from '~/modules/responses.server';

export async function loader({ params }: LoaderFunctionArgs) {
  if (!params.id) {
    throw new Error('No id provided');
  }
  const link = await getLink(params.id);
  if (!link) {
    return notFound();
  }
  // Redirect to the destination URL (moved permanently for SEO authority)
  return redirect(link.destinationUrl, { status: 301 });
}
