import { useLoaderData } from '@remix-run/react';
import { EventDetailsPage, PhotosSection, SponsorsSection, TalksSection } from '~/modules/event-details/components.tsx';
import { meta } from '~/modules/event-details/meta.ts';
import { loader } from '~/modules/event-details/loader.sever.ts';

export { headers } from '~/modules/header.server.ts';

export { loader, meta };

export default function Component() {
  const { event } = useLoaderData<typeof loader>();
  return (
    <EventDetailsPage>
      {event.talks.length > 0 && <TalksSection talks={event.talks} />}
      {event.photos.length > 0 && (
        <PhotosSection
          photos={event.photos}
          background={event.talks.length ? 'muted' : 'default'}
        />
      )}
      {event.sponsors.length > 0 && <SponsorsSection sponsors={event.sponsors} />}
    </EventDetailsPage>
  );
}
