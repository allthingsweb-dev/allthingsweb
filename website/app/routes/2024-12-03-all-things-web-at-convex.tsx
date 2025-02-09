import {
  AllYouNeedToKnowSection,
  EventDetailsPage,
  HeroSection,
  HeroSectionTitle,
  ImagesSection,
  SponsorsSection,
  TalksSection,
} from "~/modules/event-details/components";
import { meta } from "~/modules/event-details/meta";
import { eventDetailsLoader } from "~/modules/event-details/loader.sever";
import { useLoaderData } from "react-router";
import TypeAnimation from "~/modules/components/ui/typing-animation";
import { Route } from "./+types/2024-12-03-all-things-web-at-convex";
export { headers } from "~/modules/header.server";

export { meta };

export function loader({ context }: Route.LoaderArgs) {
  return eventDetailsLoader("2024-12-03-all-things-web-at-convex", {
    lumaClient: context.services.lumaClient,
    queryClient: context.services.queryClient,
    serverTimingsProfiler: context.serverTimingsProfiler,
  });
}

const HeroAnimation = (
  <TypeAnimation
    className="md:mr-auto"
    texts={["npm i react-dom@latest", "npm i react-native@latest"]}
  />
);

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
        className="md:mt-20"
        event={event}
        isAtCapacity={isAtCapacity}
        isInPast={isInPast}
      >
        <HeroSectionTitle
          event={event}
          isAtCapacity={isAtCapacity}
          isInPast={isInPast}
        >
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
