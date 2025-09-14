import { notFound } from "next/navigation";
import { Metadata } from "next";
import { getExpandedEventBySlug } from "@/lib/expanded-events";
import { isEventInPast } from "@/lib/events";
import { getEventAttendeeCount } from "@/lib/attendee-counter";
import {
  EventDetailsPage,
  HeroSection,
  HeroSectionTitle,
  AllYouNeedToKnowSection,
  ImagesSection,
  SponsorsSection,
  TalksSection,
} from "@/components/event-details";
import TypeAnimation from "@/components/ui/typing-animation";

const EVENT_SLUG = "2024-12-03-all-things-web-at-convex";

export async function generateMetadata(): Promise<Metadata> {
  const event = await getExpandedEventBySlug(EVENT_SLUG);

  if (!event) {
    return {
      title: "Event not found",
    };
  }

  return {
    title: event.name,
    description: event.tagline,
    openGraph: {
      title: event.name,
      description: event.tagline,
      images: [
        {
          url: event.previewImage.url,
          width: event.previewImage.width || 1200,
          height: event.previewImage.height || 630,
          alt: event.previewImage.alt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: event.name,
      description: event.tagline,
      images: [event.previewImage.url],
    },
  };
}

const HeroAnimation = (
  <TypeAnimation
    className="md:mr-auto"
    texts={["npm i react-dom@latest", "npm i react-native@latest"]}
  />
);

export default async function ConvexEventPage() {
  const event = await getExpandedEventBySlug(EVENT_SLUG);

  if (!event) {
    notFound();
  }

  // Get real attendee count from Luma API
  const attendeeCount = event.lumaEventId
    ? await getEventAttendeeCount(event.lumaEventId)
    : 0;
  const attendeeLimit = event.attendeeLimit;
  const isAtCapacity = attendeeCount >= attendeeLimit;
  const isInPast = isEventInPast(event);

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
