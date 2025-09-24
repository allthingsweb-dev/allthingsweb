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
  TeamsAndHacksSection,
} from "@/components/event-details";
import { Section } from "@/components/ui/section";
import { SentryLogoIcon } from "@/components/ui/icons";

const EVENT_SLUG = "2025-09-23-lightning-hackathon-at-sentry";

export async function generateMetadata(): Promise<Metadata> {
  const event = await getExpandedEventBySlug(EVENT_SLUG);

  if (!event) {
    return {
      title: "Event not found",
    };
  }

  const url = `${mainConfig.instance.origin}/${EVENT_SLUG}`;
  const imageUrl = `${mainConfig.instance.origin}/api/v1/${EVENT_SLUG}/preview.png`;

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

export default async function LightningHackathonPage() {
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
      {event.isHackathon && event.hacks && event.hacks.length > 0 && (
        <TeamsAndHacksSection hacks={event.hacks} />
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
          time="5:00 pm"
          title="Doors open"
          description="Food & drinks available. Time to form teams (5-6 PM)!"
        />
        <ScheduleItem
          time="5:30 pm"
          title="Kick-off presentation"
          description="Welcome and introduction to the lightning hackathon format."
        />
        <ScheduleItem
          time="5:45 - 7:45 pm"
          title="Hacking time ⚡"
          description="Just 2 hours to build something amazing! Use any tech or tools you like."
        />
        <ScheduleItem
          time="7:45 pm"
          title="Submission deadline"
          description="Time's up! All projects must be submitted."
        />
        <ScheduleItem
          time="7:45 - 8:00 pm"
          title="Judges select finalists"
          description="Judges will select the top 20 hacks to present."
        />
        <ScheduleItem
          time="8:00 - 9:00 pm"
          title="Presentations"
          description="Exactly 2 minutes per team, no Q&A. We'll cut the mic at 2 minutes!"
        />
        <ScheduleItem
          time="9:15 pm"
          title="Awards ceremony"
          description="Vote for winners and PS5 giveaway among presenting teams!"
        />
        <ScheduleItem
          time="9:30 pm"
          title="Doors close"
          description="Thank you for joining us for this lightning-fast hackathon!"
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
    <div className="grid grid-cols-[120px_1fr] items-start gap-4">
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
            The event will take place on Tuesday, September 23, 2025 at the
            Sentry office in San Francisco. Doors will open at 5:00 PM. Join us
            for a fast-paced, two-hour hackathon experience!
          </p>
        </div>
        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
            Awards and Prizes
          </h2>
          <p className="max-w-[600px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
            After presentations, we'll vote for the winners! We're giving away a
            <strong> PS5 </strong>among all presenting teams, plus plenty of
            merch for all winners. Every team that presents has a chance to win
            the PS5!
          </p>
        </div>
        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
            Theme: "Give your best in 2 hours"
          </h2>
          <p className="max-w-[600px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
            Create anything you want with any tech or tools you like - by hand,
            with AI, or a mix of both! <strong>The challenge:</strong> make the
            most of just two hours. Be resourceful and show us what you can do
            in this lightning-fast format!
          </p>
        </div>
        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
            Team Matching
          </h2>
          <p className="max-w-[600px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
            You'll have limited time to form teams (5-6 PM), so come ready to
            connect quickly! Teaming up is optional. Teams can have between 1
            and 3 members. Come solo and meet new people, or bring friends -
            either way works!
          </p>
        </div>
      </div>
    </div>
  );
}

function Sponsor() {
  return (
    <div className="container max-w-4xl">
      <h2 className="text-3xl font-bold md:text-center mb-8">
        Our Host & Sponsor
      </h2>
      <div className="bg-background rounded-lg shadow-lg p-8 max-w-3xl mx-auto">
        <div className="flex flex-col md:flex-row items-center md:items-start space-y-6 md:space-y-0 md:space-x-8">
          <SentryLogoIcon className="md:mt-4 max-w-24" aria-hidden="true" />
          <div className="text-left">
            <h3 className="text-2xl font-semibold mb-4">Sentry</h3>
            <p className="text-muted-foreground mb-4">
              This lightning hackathon is hosted and made possible by Sentry!
              We're thrilled to partner with Sentry for this fast-paced,
              two-hour coding challenge at their San Francisco office.
            </p>
            <p className="text-muted-foreground">
              Sentry is the debuggability platform built for how modern
              developers work. Over 4 million developers worldwide trust
              Sentry's opinionated approach to debugging—favoring action over
              dashboards—which gives them the context and code-level visibility
              they need to solve issues fast. With Sentry, developers spend more
              time building and less time firefighting.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
