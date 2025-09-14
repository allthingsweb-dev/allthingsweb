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
  ImagesSection,
} from "@/components/event-details";
import { Section } from "@/components/ui/section";
import { SentryLogoIcon } from "@/components/ui/icons";

const EVENT_SLUG = "2025-04-26-hackathon-at-sentry";

export async function generateMetadata(): Promise<Metadata> {
  const event = await getExpandedEventBySlug(EVENT_SLUG);

  if (!event) {
    return {
      title: "Event not found",
    };
  }

  const url = `${mainConfig.instance.origin}/${EVENT_SLUG}`;
  const imageUrl = `${mainConfig.instance.origin}/api/${EVENT_SLUG}/preview.png`;

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

export default async function HackathonPage() {
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
  const showEventImageSection = !!event.images.length;

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
      <Section
        variant="big"
        background={showEventImageSection ? "muted" : "default"}
      >
        <Schedule />
      </Section>
      <Section variant="big">
        <MoreInformation />
      </Section>
      <Section variant="big" background="muted">
        <Sponsor />
      </Section>
    </EventDetailsPage>
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
          time="10:30 am"
          title="Doors open"
          description="Get to know your fellow hackers and form teams."
        />
        <ScheduleItem
          time="11:00 am"
          title="Kick-off presentation"
          description="Get ready for a day of coding, networking, and fun!"
        />
        <ScheduleItem
          time="1 - 7:30 pm"
          title="Hacking time"
          description="Focus on your project, ask for help, and enjoy the snacks."
        />
        <ScheduleItem
          time="7:30 pm"
          title="Presentations & awards ceremony"
          description="Show off your project and vote for the best ones!"
        />
        <ScheduleItem
          time="8:30 pm"
          title="Closing doors"
          description="Thank you for joining us! We hope you had a great time."
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

function MoreInformation() {
  return (
    <div className="container">
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-12">
        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
            When and Where
          </h2>
          <p className="max-w-[600px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
            This is a full-day hackathon on Saturday, April 26, at the Sentry
            office in San Francisco! Doors will open at 10:30 am.
          </p>
        </div>
        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
            Awards and Prizes
          </h2>
          <p className="max-w-[600px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
            At the end of the event, we'll vote for the most creative and most
            impactful projects. The winning teams will score some awesome
            prizes! Stay tuned for more details!
          </p>
        </div>
        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
            Theme
          </h2>
          <p className="max-w-[600px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
            "Future of Web" is the theme for this hackathon. Let's imagine the
            future of web UI, interactions, and AI. Please feel free to work on
            whatever else sparks your interest though.
          </p>
        </div>
        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
            Team Matching
          </h2>
          <p className="max-w-[600px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
            It's not required to bring a team, though you can bring friends,
            team up on the spot, or fly solo if that's more your style. We'll
            kick things off with some fun icebreakers and socializing. Teaming
            up isn't mandatory, but it's an awesome way to make new friends!
          </p>
        </div>
      </div>
    </div>
  );
}

function Sponsor() {
  return (
    <div className="container max-w-4xl">
      <h2 className="text-3xl font-bold md:text-center mb-8">Our Sponsor</h2>
      <div className="bg-background rounded-lg shadow-lg p-8 max-w-3xl mx-auto">
        <div className="flex flex-col md:flex-row items-center md:items-start space-y-6 md:space-y-0 md:space-x-8">
          <SentryLogoIcon className="md:mt-4 max-w-24" aria-hidden="true" />
          <div className="text-left">
            <h3 className="text-2xl font-semibold mb-4">Sentry</h3>
            <p className="text-muted-foreground mb-4">
              This hackathon is made possible by Sentry! We are huge fans of
              Sentry and are very excited to have Sentry host and sponsor this
              event. Actually, we are using Sentry to monitor this very website!
            </p>
            <p className="text-muted-foreground">
              Sentry is the debuggability platform built for how modern
              developers work. Over 4 million developers worldwide trust
              Sentry's opinionated approach to debugging—favoring action over
              dashboards—which gives them the context and code level visibility
              they need to solve issues fast. Sentry users spend more time
              building and less time firefighting.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
