import { EventDetailsPage, PhotosSection, SponsorsSection, TalksSection } from '~/modules/event-details/components';
import { meta } from '~/modules/event-details/meta';
import { eventDetailsLoader } from '~/modules/event-details/loader.sever';
import { useLoaderData } from '@remix-run/react';
import TypeAnimation from '~/modules/components/ui/typing-animation';
import { LoaderFunctionArgs } from '@remix-run/node';
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
  <TypeAnimation className="mx-auto" texts={['npm i react-dom@latest', 'npm i react-native@latest']} />
);

export default function Component() {
  const { event } = useLoaderData<typeof loader>();
  return (
    <EventDetailsPage heroContent={HeroAnimation}>
      {event.talks.length > 0 && <TalksSection talks={event.talks} />}
      {event.photos.length > 0 && (
        <PhotosSection photos={event.photos} background={event.talks.length ? 'muted' : 'default'} />
      )}
      {event.sponsors.length > 0 && <SponsorsSection sponsors={event.sponsors} />}
    </EventDetailsPage>
  );
}
