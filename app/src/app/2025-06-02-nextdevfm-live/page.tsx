import { notFound } from "next/navigation";
import { Metadata } from "next";
import Link from "next/link";
import { getExpandedEventBySlug } from "@/lib/expanded-events";
import { isEventInPast } from "@/lib/events";
import {
  EventDetailsPage,
  HeroSection,
  AllYouNeedToKnowSection,
  ImagesSection,
  SponsorsSection,
} from "@/components/event-details";
import { Section } from "@/components/ui/section";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { SocialsList } from "@/components/profile-card";
import { TwitterLogoIcon } from "@/components/ui/icons";

const EVENT_SLUG = "2025-06-02-nextdevfm-live";

// Profile IDs for the podcast hosts and guest
const ryanVogelId = "2fb6b3b8-2bf7-437f-83e2-bc60ad00890a";
const danGoosewinId = "8b86e373-0709-4086-97e7-4e83102a6564";
const tedNymanId = "419b7781-718b-41cc-aa7a-a3a4a334cf74";

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

export default async function NextDevFmLivePage() {
  const event = await getExpandedEventBySlug(EVENT_SLUG);

  if (!event) {
    notFound();
  }

  // Mock attendee data - in a real app, you'd fetch this from Luma API
  const attendeeCount = Math.floor(Math.random() * event.attendeeLimit);
  const attendeeLimit = event.attendeeLimit;
  const isAtCapacity = attendeeCount >= attendeeLimit;
  const isInPast = isEventInPast(event);
  const showEventImageSection = !!event.images.length;

  // Try to find the profiles for the podcast hosts and guest from event.talks or event.speakers
  const allProfiles = event.talks?.flatMap((talk) => talk.speakers) || [];
  const getProfile = (id: string) =>
    allProfiles.find((p) => p.id === id) || null;
  const ryan = getProfile(ryanVogelId);
  const dan = getProfile(danGoosewinId);
  const ted = getProfile(tedNymanId);

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
      {showEventImageSection && (
        <ImagesSection background="default" images={event.images} />
      )}
      <LivePodcastSection
        showEventImageSection={showEventImageSection}
        hosts={[ryan, dan]}
        guest={ted}
      />
      <Section
        variant="big"
        background={showEventImageSection ? "default" : "muted"}
      >
        <Schedule />
      </Section>
      <Section
        variant="big"
        background={showEventImageSection ? "muted" : "default"}
      >
        <SponsorsSection sponsors={event.sponsors} />
      </Section>
    </EventDetailsPage>
  );
}

function LivePodcastSection({
  hosts,
  guest,
  showEventImageSection,
}: {
  hosts: (any | null)[];
  guest: any | null;
  showEventImageSection: boolean;
}) {
  return (
    <Section
      variant="big"
      background={showEventImageSection ? "muted" : "default"}
    >
      <div className="container flex flex-col gap-8 items-center">
        <div className="flex flex-col items-center gap-2">
          <h2 className="text-3xl font-bold text-center tracking-tight">
            Live Podcast Episode: NextDev.fm
          </h2>
          <div className="flex items-center gap-2">
            <Link
              href="https://nextdev.fm"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary font-medium underline underline-offset-2 hover:text-primary/80"
            >
              nextdev.fm
            </Link>
            <Link
              href="https://twitter.com/nextdevfm"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary font-medium underline underline-offset-2 hover:text-primary/80"
            >
              <TwitterLogoIcon className="w-4 h-4" />
              <span className="sr-only">@nextdevfm on Twitter</span>
            </Link>
          </div>
        </div>
        <div className="flex flex-col md:flex-row gap-8 w-full max-w-4xl justify-center items-center">
          {/* Hosts */}
          <div className="flex flex-col items-center flex-1">
            <h3 className="text-xl font-semibold mb-2">Hosts</h3>
            <div className="flex flex-col md:flex-row gap-6 w-full items-center md:items-stretch">
              {hosts.map(
                (host, i) =>
                  host && (
                    <Card
                      key={host.id}
                      className="flex flex-col w-full max-w-xs md:w-80"
                    >
                      <CardHeader className="flex flex-col items-center">
                        <Avatar className="w-16 h-16 mb-2">
                          <AvatarImage src={host.image.url} alt={host.name} />
                          <AvatarFallback>{host.name[0]}</AvatarFallback>
                        </Avatar>
                        <CardTitle className="text-center">
                          {host.name}
                        </CardTitle>
                        {host.title && (
                          <CardDescription className="text-center">
                            {host.title}
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent className="flex flex-col h-full">
                        <p className="text-muted-foreground text-sm mb-2 text-center">
                          {host.bio}
                        </p>
                        <div className="mt-auto">
                          <SocialsList socials={host.socials} />
                        </div>
                      </CardContent>
                    </Card>
                  ),
              )}
            </div>
          </div>
          {/* Guest */}
          {guest && (
            <div className="flex flex-col items-center flex-1">
              <h3 className="text-xl font-semibold mb-2">Guest</h3>
              <Card className="w-full max-w-xs md:w-80">
                <CardHeader className="flex flex-col items-center">
                  <Avatar className="w-16 h-16 mb-2">
                    <AvatarImage src={guest.image.url} alt={guest.name} />
                    <AvatarFallback>{guest.name[0]}</AvatarFallback>
                  </Avatar>
                  <CardTitle className="text-center">{guest.name}</CardTitle>
                  {guest.title && (
                    <CardDescription className="text-center">
                      {guest.title}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="flex flex-col h-full">
                  <p className="text-muted-foreground text-sm mb-2 text-center flex-grow">
                    {guest.bio}
                  </p>
                  <div className="mt-auto">
                    <SocialsList socials={guest.socials} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
        <div className="text-center text-muted-foreground max-w-2xl mx-auto mt-4">
          We are hanging out with Dan and Ryan as they chat with Ted Nyman - CEO
          Cased, prev CTO & Systems Eng GitHub - about their journey in tech -
          and, of course, all things web. It's going to be a good one. Don't
          miss it!
        </div>
      </div>
    </Section>
  );
}

function Schedule() {
  return (
    <div className="px-4 md:px-6 mx-auto max-w-4xl">
      <div className="mb-8">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Schedule
        </h2>
      </div>
      <div className="space-y-6">
        <ScheduleItem
          time="5:00 pm"
          title="Doors open"
          description="Arrive, grab some snacks and drinks, and get to know everyone."
        />
        <ScheduleItem
          time="6:00 pm"
          title="Live podcast episode"
          description="Ted Nyman interviewed by Ryan Vogel and Dan Goosewin."
        />
        <ScheduleItem
          time="~7:00 pm"
          title="Hang out & chat"
          description="Stick around, chat, and enjoy the evening together."
        />
        <ScheduleItem
          time="8:00 - 8:30 pm"
          title="Winding down"
          description="Keep hanging out until we close up."
        />
        <ScheduleItem
          time="8:30 pm"
          title="Doors close"
          description={
            "We'll probably grab a drink or some food after—join us if you like!"
          }
        />
      </div>
    </div>
  );
}

function ScheduleItem({
  time,
  title,
  description,
}: {
  time: string;
  title: string;
  description: string;
}) {
  return (
    <div className="grid grid-cols-[100px_1fr] items-start gap-4">
      <div className="text-sm font-medium text-muted-foreground">{time}</div>
      <div>
        <h3 className="text-lg font-medium">{title}</h3>
        <p className="text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
