import {
  AllYouNeedToKnowSection,
  EventDetailsPage,
  HeroSection,
  PhotosSection,
  SponsorsSection,
  TalksSection,
} from '~/modules/event-details/components';
import { meta } from '~/modules/event-details/meta';
import { loader } from '~/modules/event-details/loader.sever';
import { useLoaderData } from 'react-router';
import { deserializeExpandedEvent } from '~/modules/allthingsweb/public-types';

export { headers } from '~/modules/header.server';

export { meta, loader };

export default function Component() {
  const { event: eventData, isAtCapacity, attendeeCount, attendeeLimit, isInPast } = useLoaderData<typeof loader>();
  const event = deserializeExpandedEvent(eventData);
  return (
    <EventDetailsPage event={event} isAtCapacity={isAtCapacity} isInPast={isInPast}>
      <HeroSection event={event} isAtCapacity={isAtCapacity} isInPast={isInPast} />
      <AllYouNeedToKnowSection
        event={event}
        attendeeCount={attendeeCount}
        attendeeLimit={attendeeLimit}
        isInPast={isInPast}
      />
      {event.talks.length > 0 && <TalksSection talks={event.talks} />}
      {event.photos.length > 0 && (
        <PhotosSection photos={event.photos} background={event.talks.length ? 'muted' : 'default'} />
      )}
      {event.sponsors.length > 0 && <SponsorsSection sponsors={event.sponsors} />}
    </EventDetailsPage>
  );
}
