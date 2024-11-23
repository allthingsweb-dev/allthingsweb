import {
  AllYouNeedToKnowSection,
  EventDetailsPage,
  HeroSection,
  HeroSectionTitle,
  PhotosSection,
  SponsorsSection,
  TalksSection,
} from '~/modules/event-details/components';
import { meta } from '~/modules/event-details/meta';
import { eventDetailsLoader } from '~/modules/event-details/loader.sever';
import { useLoaderData } from '@remix-run/react';
import TypeAnimation from '~/modules/components/ui/typing-animation';
import { LoaderFunctionArgs } from '@remix-run/node';
import { deserializeExpandedEvent } from '~/modules/pocketbase/pocketbase';
export { headers } from '~/modules/header.server';

export { meta };

export function loader({ context }: LoaderFunctionArgs) {
  return eventDetailsLoader('2024-12-03-all-things-web-at-convex', {
    lumaClient: context.services.lumaClient,
    pocketBaseClient: context.services.pocketBaseClient,
    serverTimingsProfiler: context.serverTimingsProfiler,
  });
}

const HeroAnimation = (
  <TypeAnimation className="md:mr-auto" texts={['npm i react-dom@latest', 'npm i react-native@latest']} />
);

export default function Component() {
  const { event: eventData, isAtCapacity, attendeeCount, attendeeLimit, isInPast } = useLoaderData<typeof loader>();
  const event = deserializeExpandedEvent(eventData);
  return (
    <EventDetailsPage event={event} isAtCapacity={isAtCapacity} isInPast={isInPast}>
      <HeroSection className="md:mt-20" event={event} isAtCapacity={isAtCapacity} isInPast={isInPast}>
        <HeroSectionTitle event={event} isAtCapacity={isAtCapacity} isInPast={isInPast}>
          {HeroAnimation}
        </HeroSectionTitle>
      </HeroSection>
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
