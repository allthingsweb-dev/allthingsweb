import { notFound } from "next/navigation";
import { Metadata } from "next";
import { getExpandedEventBySlug } from "@/lib/expanded-events";
import { isEventInPast } from "@/lib/events";
import { mainConfig } from "@/lib/config";
import {
  EventDetailsPage,
  HeroSection,
  AllYouNeedToKnowSection,
  TalksSection,
  ImagesSection,
  SponsorsSection,
  TeamsAndHacksSection,
} from "@/components/event-details";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await getExpandedEventBySlug(slug);

  if (!event || event.isDraft) {
    return {
      title: "Event not found",
    };
  }

  const url = `${mainConfig.instance.origin}/${slug}`;
  const imageUrl = `${mainConfig.instance.origin}/api/v1/${slug}/preview.png`;

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
      site: "@allthingswebdev",
      creator: "@allthingswebdev",
    },
  };
}

export default async function EventPage({ params }: PageProps) {
  const { slug } = await params;
  const event = await getExpandedEventBySlug(slug);

  if (!event || event.isDraft) {
    notFound();
  }

  const isInPast = isEventInPast(event);

  return (
    <EventDetailsPage event={event} isInPast={isInPast}>
      <HeroSection event={event} isInPast={isInPast} />
      <AllYouNeedToKnowSection event={event} isInPast={isInPast} />
      {event.talks.length > 0 && <TalksSection talks={event.talks} />}
      {event.images.length > 0 && (
        <ImagesSection
          images={event.images}
          background={event.talks.length ? "muted" : "default"}
        />
      )}
      {event.isHackathon && event.hacks && event.hacks.length > 0 && (
        <TeamsAndHacksSection hacks={event.hacks} />
      )}
      {event.sponsors.length > 0 && (
        <SponsorsSection sponsors={event.sponsors} />
      )}
    </EventDetailsPage>
  );
}
