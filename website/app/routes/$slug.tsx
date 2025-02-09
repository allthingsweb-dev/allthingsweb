import {
  AllYouNeedToKnowSection,
  EventDetailsPage,
  HeroSection,
  ImagesSection,
  SponsorsSection,
  TalksSection,
} from "~/modules/event-details/components";
import { meta } from "~/modules/event-details/meta";
import { loader } from "~/modules/event-details/loader.sever";
import { useLoaderData } from "react-router";

export { headers } from "~/modules/header.server";

export { meta, loader };

export default function Component() {
  const { event, isAtCapacity, attendeeCount, attendeeLimit, isInPast } =
    useLoaderData<typeof loader>();
  return (
    <EventDetailsPage
      event={event}
      isAtCapacity={isAtCapacity}
      isInPast={isInPast}
    >
      <HeroSection
        event={event}
        isAtCapacity={isAtCapacity}
        isInPast={isInPast}
      />
      <AllYouNeedToKnowSection
        event={event}
        attendeeCount={attendeeCount}
        attendeeLimit={attendeeLimit}
        isInPast={isInPast}
      />
      {event.talks.length > 0 && <TalksSection talks={event.talks} />}
      {event.images.length > 0 && (
        <ImagesSection
          images={event.images}
          background={event.talks.length ? "muted" : "default"}
        />
      )}
      {event.sponsors.length > 0 && (
        <SponsorsSection sponsors={event.sponsors} />
      )}
    </EventDetailsPage>
  );
}
