import { EventDetailsPage, PhotosSection, SponsorsSection, TalksSection } from '~/modules/event-details/components';
import { meta } from '~/modules/event-details/meta';
import { useLoaderData } from '@remix-run/react';
import { json, LoaderFunctionArgs } from '@remix-run/node';

export { headers } from '~/modules/header.server';
export { meta };

export async function loader({ params, context }: LoaderFunctionArgs) {
  if (!params.slug) {
    throw new Error('No slug provided');
  }
  const query = context.createQuery('LoadEventDetails', { slug: params.slug });
  const { result: eventDetails } = await context.dispatchQuery(query);
  return json(eventDetails, { headers: context.services.serverTimingsProfiler.getServerTimingHeader() });
}

export default function Component() {
  const { event } = useLoaderData<typeof loader>();
  return (
    <EventDetailsPage>
      {event.talks.length > 0 && <TalksSection talks={event.talks} />}
      {event.photos.length > 0 && (
        <PhotosSection photos={event.photos} background={event.talks.length ? 'muted' : 'default'} />
      )}
      {event.sponsors.length > 0 && <SponsorsSection sponsors={event.sponsors} />}
    </EventDetailsPage>
  );
}
