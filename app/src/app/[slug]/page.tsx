import { notFound } from "next/navigation";
import { Metadata } from "next";
import { getExpandedEventBySlug } from "@/lib/expanded-events";
import { isEventInPast } from "@/lib/events";
import { getEventAttendeeCount } from "@/lib/attendee-counter";
import { mainConfig } from "@/lib/config";
import {
  EventDetailsPage,
  HeroSection,
  AllYouNeedToKnowSection,
  TalksSection,
  ImagesSection,
  SponsorsSection,
} from "@/components/event-details";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await getExpandedEventBySlug(slug);

  if (!event) {
    return {
      title: "Event not found",
    };
  }

  const url = `${mainConfig.instance.origin}/${slug}`;
  const imageUrl = `${mainConfig.instance.origin}/api/${slug}/preview.png`;

  return {
    title: event.name,
    description: event.tagline,
    openGraph: {
      title: event.name,
      description: event.tagline,
      url,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: event.name,
        },
      ],
      type: "website",
      siteName: "All Things Web",
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title: event.name,
      description: event.tagline,
      images: [imageUrl],
      site: "@ReactBayArea",
      creator: "@ReactBayArea",
    },
  };
}

export default async function EventPage({ params }: PageProps) {
  const { slug } = await params;
  const event = await getExpandedEventBySlug(slug);

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
