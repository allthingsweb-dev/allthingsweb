import { notFound, permanentRedirect } from "next/navigation";
import { Metadata } from "next";
import { getExpandedEventBySlug } from "@/lib/expanded-events";
import { db } from "@/lib/db";
import { longSlugForShortLink } from "@/lib/short-links";
import { isEventInPast } from "@/lib/events";
import { mainConfig } from "@/lib/config";
import {
  EventDetailsPage,
  HeroSection,
  AllYouNeedToKnowSection,
  TalksSection,
  ImagesSection,
  HostsSection,
} from "@/components/event-details";

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * The published event at `slug`. A short link the new site gives
 * (core/src/short-slugs.ts) is sent to its event's page here for good,
 * first, as the new site prefers a link to a long slug; anything else
 * that is no published event is not found.
 */
async function publishedEvent(slug: string) {
  const long = await longSlugForShortLink(db, slug);
  if (long !== null && long !== slug) {
    return permanentRedirect(`/${encodeURIComponent(long)}`);
  }
  const event = await getExpandedEventBySlug(slug);
  return event && !event.isDraft ? event : notFound();
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const event = await publishedEvent(slug);

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
  const event = await publishedEvent(slug);

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
      {event.hosts.length > 0 && <HostsSection hosts={event.hosts} />}
    </EventDetailsPage>
  );
}
