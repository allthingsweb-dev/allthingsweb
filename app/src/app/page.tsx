import {
  ArrowRightIcon,
  CalendarIcon,
  MapPinIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { Metadata } from "next";
import { eq, and, gt, lte, gte, lt, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { eventsTable, imagesTable } from "@/lib/schema";
import { PageLayout } from "@/components/page-layout";
import { Section } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { EventsCarousel } from "@/components/event-carousel";
import { DiscordLogoIcon } from "@/components/ui/icons";
import { Event, Image } from "@/lib/events";
import { toReadableDateTimeStr } from "@/lib/datetime";
import { getPastEventImages } from "@/lib/images";
import { signImage } from "@/lib/image-signing";
import { getLumaUrl } from "@/lib/luma";
import NextImage from "next/image";

// Homepage metadata - the layout already provides the base metadata
// This ensures the homepage gets "All Things Web" instead of "All Things Web | All Things Web"
export const metadata: Metadata = {
  title: "All Things Web",
};

async function getEvents() {
  const now = new Date();

  // Transform to Event type
  const transformToEvent = async (row: any): Promise<Event> => {
    const event = row.events;
    const previewImageRaw = row.images || {
      url: "/hero-image-rocket.png",
      alt: `${event.name} preview`,
      placeholder: null,
      width: 1200,
      height: 630,
    };

    const previewImage = await signImage(previewImageRaw);

    return {
      ...event,
      previewImage,
      lumaEventUrl: getLumaUrl(event.lumaEventId),
    };
  };

  // Execute all database queries in parallel for better performance
  const [
    upcomingEventsQuery,
    liveEventsQuery,
    pastEventsQuery,
    pastEventImages,
  ] = await Promise.all([
    // Get upcoming events
    db
      .select()
      .from(eventsTable)
      .where(
        and(gt(eventsTable.startDate, now), eq(eventsTable.isDraft, false)),
      )
      .leftJoin(imagesTable, eq(eventsTable.previewImage, imagesTable.id))
      .orderBy(eventsTable.startDate),

    // Get live events
    db
      .select()
      .from(eventsTable)
      .where(
        and(
          lte(eventsTable.startDate, now),
          gte(eventsTable.endDate, now),
          eq(eventsTable.isDraft, false),
        ),
      )
      .leftJoin(imagesTable, eq(eventsTable.previewImage, imagesTable.id))
      .orderBy(desc(eventsTable.startDate)),

    // Get past events
    db
      .select()
      .from(eventsTable)
      .where(and(lt(eventsTable.endDate, now), eq(eventsTable.isDraft, false)))
      .leftJoin(imagesTable, eq(eventsTable.previewImage, imagesTable.id))
      .orderBy(desc(eventsTable.startDate))
      .limit(10),

    // Get past event images for the hero
    getPastEventImages(),
  ]);

  const upcomingEvents = await Promise.all(
    upcomingEventsQuery.map(transformToEvent),
  );
  const liveEvents = await Promise.all(liveEventsQuery.map(transformToEvent));
  const pastEvents = await Promise.all(pastEventsQuery.map(transformToEvent));

  const highlightEvent =
    upcomingEvents.length > 0
      ? upcomingEvents.reduce((earliest, current) =>
          new Date(current.startDate) < new Date(earliest.startDate)
            ? current
            : earliest,
        )
      : null;

  const remainingEvents = upcomingEvents.filter(
    (event) => event.id !== highlightEvent?.id,
  );

  return {
    highlightEvent,
    remainingEvents,
    liveEvents,
    pastEvents,
    pastEventImages,
  };
}

export default async function HomePage() {
  const {
    highlightEvent,
    remainingEvents,
    liveEvents,
    pastEvents,
    pastEventImages,
  } = await getEvents();

  return (
    <PageLayout>
      <LandingHero images={pastEventImages} />

      {liveEvents.length > 0 && liveEvents[0] && (
        <Section variant="big" background="muted">
          <div className="container">
            <div className="flex flex-col items-center space-y-4 text-center">
              <div className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
                  Happening Now: {liveEvents[0].name}
                </h2>
                <p className="max-w-[900px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
                  {liveEvents[0].tagline}
                </p>
              </div>
              <div className="flex justify-center items-center gap-4 text-muted-foreground md:text-xl lg:text-base xl:text-xl">
                <div className="flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4" />
                  <span>
                    {toReadableDateTimeStr(liveEvents[0].startDate, true)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPinIcon className="h-4 w-4" />
                  <span>{liveEvents[0].shortLocation}</span>
                </div>
              </div>
              <div className="w-full max-w-sm pt-4">
                <Button asChild>
                  <Link href={`/${liveEvents[0].slug}`}>
                    See details
                    <ArrowRightIcon className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </Section>
      )}

      {highlightEvent && (
        <Section
          variant="big"
          background={liveEvents.length > 0 ? "default" : "muted"}
        >
          <div className="container">
            <div className="flex flex-col items-center space-y-4 text-center">
              <div className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
                  Coming Next: {highlightEvent.name}
                </h2>
                <p className="max-w-[900px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
                  {highlightEvent.tagline}
                </p>
              </div>
              <div className="flex justify-center items-center gap-4 text-muted-foreground md:text-xl lg:text-base xl:text-xl">
                <div className="flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4" />
                  <span>
                    {toReadableDateTimeStr(highlightEvent.startDate, true)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPinIcon className="h-4 w-4" />
                  <span>{highlightEvent.shortLocation}</span>
                </div>
              </div>
              <div className="w-full max-w-sm pt-4">
                <Button asChild>
                  <Link href={`/${highlightEvent.slug}`}>
                    See details
                    <ArrowRightIcon className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </Section>
      )}

      {liveEvents.length > 1 && (
        <OtherLiveEventsSection events={liveEvents.slice(1)} />
      )}

      {remainingEvents.length > 0 && (
        <OtherUpcomingEventsSection events={remainingEvents} />
      )}

      <Section variant="big" className="bg-indigo-600 text-white">
        <div className="container">
          <div className="flex flex-col items-center space-y-4 text-center">
            <div className="space-y-2">
              <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
                Join our Discord
              </h2>
              <p className="mx-auto max-w-[700px] text-gray-200 md:text-xl">
                Connect with fellow developers, share ideas, and stay updated on
                the latest events and opportunities.
              </p>
            </div>
            <div className="space-x-4">
              <Button
                className="inline-flex h-9 items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-indigo-600 shadow transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-950 disabled:pointer-events-none disabled:opacity-50"
                asChild
              >
                <Link
                  href="https://discord.gg/B3Sm4b5mfD"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <DiscordLogoIcon className="mr-2 h-4 w-4" />
                  Join Discord
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </Section>

      <PastEventsSection events={pastEvents} />
    </PageLayout>
  );
}

function LandingHero({ images }: { images: Image[] }) {
  return (
    <section className="w-full h-[80vh] overflow-hidden grid [&>*]:col-[1] [&>*]:row-[1]">
      <div className="w-full h-full grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1">
        {images.map((image, index) => (
          <div
            key={image.url + index}
            className="relative w-full aspect-square overflow-hidden"
          >
            <NextImage
              src={image.url}
              placeholder={image.placeholder ? "blur" : undefined}
              blurDataURL={image.placeholder || undefined}
              fill
              className="object-cover"
              priority
              alt={image.alt || `Event image ${index + 1}`}
              sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 20vw"
            />
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="z-20 bg-gradient-to-b from-black/70 to-black/30 flex flex-col items-center pt-[30vh] text-center text-white px-4">
        <h1 className="mb-4 text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight">
          All Things Web 🚀
        </h1>
        <p className="max-w-2xl text-lg sm:text-xl">
          Discover exciting web development events in the Bay Area and San
          Francisco. Join us for hackathons, hangouts, and meetups to connect
          with fellow developers and web enthusiasts.
        </p>
      </div>
    </section>
  );
}

function OtherUpcomingEventsSection({ events }: { events: Event[] }) {
  return (
    <Section variant="big">
      <div className="container">
        <div className="flex flex-col items-center space-y-4 text-center mb-8">
          <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
            Other events
          </h2>
          <p className="text-muted-foreground md:text-xl max-w-[700px]">
            Discover more upcoming web development events in the Bay Area here
            or on Luma.
          </p>
          <Button variant="outline" asChild>
            <Link
              href="https://lu.ma/allthingsweb?utm_source=web"
              target="_blank"
              rel="noopener noreferrer"
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              View events on Luma calendar
            </Link>
          </Button>
        </div>
        <EventsCarousel events={events} />
      </div>
    </Section>
  );
}

function PastEventsSection({ events }: { events: Event[] }) {
  return (
    <Section variant="big">
      <div className="container">
        <div className="flex flex-col items-center space-y-4 text-center mb-8">
          <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-center mb-4">
            Past events
          </h2>
          <p className="text-muted-foreground md:text-xl max-w-[700px]">
            Find out what we&apos;ve been up to in the past. Check out our
            previous web development meetups and hackathons.
          </p>
          <Button variant="outline" asChild>
            <Link href="/speakers">
              <UsersIcon className="mr-2 h-4 w-4" />
              View all speakers
            </Link>
          </Button>
        </div>
        <EventsCarousel events={events} />
      </div>
    </Section>
  );
}

function OtherLiveEventsSection({ events }: { events: Event[] }) {
  return (
    <Section variant="big">
      <div className="container">
        <div className="flex flex-col items-center space-y-4 text-center mb-8">
          <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
            Other ongoing events
          </h2>
          <p className="text-muted-foreground md:text-xl max-w-[700px]">
            More events happening right now! Join us if you can.
          </p>
        </div>
        <EventsCarousel events={events} />
      </div>
    </Section>
  );
}
