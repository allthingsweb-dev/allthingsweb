import {
  AlertCircleIcon,
  CalendarIcon,
  InfoIcon,
  MapPinIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import NextImage from "next/image";
import clsx from "clsx";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toReadableDateTimeStr, toWeekdayStr } from "@/lib/datetime";
import { Section } from "@/components/ui/section";
import { PageLayout } from "@/components/page-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type {
  ExpandedEvent,
  Talk,
  Sponsor,
  Speaker,
} from "@/lib/expanded-events";
import type { Image } from "@/lib/events";
import { SocialsList } from "@/components/profile-card";

export function HeroSectionTitle({
  event,
  isAtCapacity,
  isInPast,
  children,
}: {
  event: ExpandedEvent;
  isAtCapacity: boolean;
  isInPast: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col justify-center space-y-4">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tighter sm:text-5xl xl:text-6xl/none">
          {event.name}
        </h1>
        <p className="max-w-[600px] text-muted-foreground md:text-xl">
          {event.tagline}
        </p>
      </div>

      <div className="flex flex-col gap-2 min-[400px]:flex-row">
        {event.recordingUrl && (
          <Button asChild variant="default" size="lg">
            <Link
              href={event.recordingUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              View recording
            </Link>
          </Button>
        )}
        {event.lumaEventUrl && (
          <Button asChild variant={isInPast ? "outline" : "default"} size="lg">
            <Link
              href={event.lumaEventUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {isInPast
                ? "View on Luma"
                : isAtCapacity
                  ? "Join waitlist on Luma"
                  : "Register on Luma"}
            </Link>
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

export function HeroSectionImage({
  imgSrc,
  imgAlt,
}: {
  imgSrc: string;
  imgAlt: string;
}) {
  return (
    <NextImage
      src={imgSrc}
      width={1200}
      height={1200}
      alt={imgAlt}
      className="mx-auto aspect-video overflow-hidden rounded-xl object-cover sm:w-full lg:order-last lg:aspect-square"
      priority
    />
  );
}

export function HeroSection({
  event,
  isInPast,
  isAtCapacity,
  children,
  className,
}: {
  event: ExpandedEvent;
  isAtCapacity: boolean;
  isInPast: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Section variant="big" className={className}>
      <div className="container">
        <div className="flex flex-col lg:flex-row items-center justify-center gap-6 lg:gap-12">
          {!!children ? (
            children
          ) : (
            <>
              <HeroSectionTitle
                event={event}
                isAtCapacity={isAtCapacity}
                isInPast={isInPast}
              />
              <div className="w-full lg:max-w-[400px] xl:max-w-[600px]">
                <HeroSectionImage
                  imgSrc={
                    event.isHackathon
                      ? "/hero-image-hackathon.png"
                      : "/hero-image-meetup.png"
                  }
                  imgAlt={
                    event.isHackathon
                      ? "Four cartoon-style developers cheerfully throwing their arms up, surrounded by confetti. In the center, a desk with a laptop displaying code."
                      : "A group of cartoon-style developers standing in a circle, chatting and laughing together."
                  }
                />
              </div>
            </>
          )}
        </div>
      </div>
    </Section>
  );
}

export function AllYouNeedToKnowSection({
  event,
  attendeeLimit,
  attendeeCount,
  isInPast,
}: {
  event: ExpandedEvent;
  attendeeLimit: number;
  attendeeCount: number;
  isInPast: boolean;
}) {
  return (
    <Section variant="big" background="muted">
      <div className="w-full px-4 md:px-6 flex flex-col gap-8 sm:gap-12 lg:items-center lg:justify-center lg:flex-row lg:gap-16 xl:gap-24">
        <h2 className="sr-only">All you need to know</h2>
        <div className="flex items-center gap-4">
          <UsersIcon className="h-12 w-12 text-primary flex-shrink-0" />
          <div className="min-w-0">
            <h3 className="text-xl lg:text-2xl xl:text-3xl font-medium">
              {!isInPast && attendeeCount < attendeeLimit
                ? "Spots available"
                : !isInPast && attendeeCount >= attendeeLimit
                  ? "At capacity"
                  : "Event has ended"}
            </h3>
            <p className="text-lg lg:text-xl text-muted-foreground">
              {attendeeCount} / {attendeeLimit} guests registered
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <MapPinIcon className="h-12 w-12 text-primary flex-shrink-0" />
          <div className="min-w-0">
            <h3 className="text-xl lg:text-2xl xl:text-3xl font-medium">
              {event.shortLocation}
            </h3>
            <p className="text-lg lg:text-xl text-muted-foreground">
              {event.streetAddress}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <CalendarIcon className="h-12 w-12 text-primary flex-shrink-0" />
          <div className="min-w-0">
            <h3 className="text-xl lg:text-2xl xl:text-3xl font-medium">
              {toWeekdayStr(event.startDate)}
            </h3>
            <p className="text-lg lg:text-xl text-muted-foreground">
              {toReadableDateTimeStr(event.startDate, false)}
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}

export function TalksSection({ talks }: { talks: Talk[] }) {
  return (
    <Section id="talks" variant="big">
      <div className="container flex flex-col gap-8">
        <h2 className="text-3xl font-bold text-center tracking-tight">Talks</h2>
        <div
          className={clsx(
            "mx-auto grid gap-4 grid-cols-[repeat(1,minmax(auto,800px))]",
            {
              "lg:grid-cols-[repeat(2,minmax(auto,800px))]": talks.length >= 2,
            },
          )}
        >
          {talks.map((talk) => (
            <Card key={talk.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-center space-x-4 mb-2">
                  <Avatar className="w-12 h-12">
                    <AvatarImage
                      src={talk.speakers[0].image.url}
                      alt={talk.speakers[0].name}
                    />
                    <AvatarFallback>{talk.speakers[0].name}</AvatarFallback>
                  </Avatar>
                  <div>
                    <CardTitle>{talk.speakers[0].name}</CardTitle>
                    <CardDescription>{talk.speakers[0].title}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-grow flex flex-col items-start gap-4">
                <h4 className="text-2xl">{talk.title}</h4>
                <div
                  className={clsx(
                    "text-muted-foreground flex flex-col gap-2",
                    "[&_a]:text-primary hover:[&_a]:text-primary/80 [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-2 [&_a]:decoration-primary hover:[&_a]:decoration-primary/80 focus-visible:[&_a]:outline-none focus-visible:[&_a]:ring-1 focus-visible:[&_a]:ring-ring",
                    "[&_ul]:list-inside [&_ul]:list-disc",
                  )}
                  dangerouslySetInnerHTML={{ __html: talk.description }}
                />
                <div className="flex-grow flex flex-col items-start gap-2">
                  <h4 className="font-semibold">About the Speaker</h4>
                  <p className="text-muted-foreground">
                    {talk.speakers[0].bio}
                  </p>
                </div>
              </CardContent>
              <CardFooter>
                <SocialsList socials={talk.speakers[0].socials} />
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function SponsorsSection({ sponsors }: { sponsors: Sponsor[] }) {
  return (
    <Section variant="big">
      <div className="container">
        <h2 className="text-3xl font-bold md:text-center mb-8">
          {sponsors.length === 1 ? "Event Sponsor" : "Event Sponsors"}
        </h2>
        <div className="flex flex-col gap-4 md:gap-8 items-center justify-center">
          {sponsors.map((sponsor) => (
            <div
              key={sponsor.id}
              className="bg-background rounded-lg shadow-lg p-8 max-w-3xl mx-auto"
            >
              <div className="flex flex-col md:flex-row items-center space-y-6 md:space-y-0 md:space-x-8">
                <NextImage
                  src={sponsor.squareLogoLight.url}
                  width={96}
                  height={96}
                  alt={sponsor.name}
                  className="min-w-[48px] max-h-[48px] object-contain"
                />
                <div className="text-left">
                  <h3 className="text-2xl font-semibold mb-4">
                    {sponsor.name}
                  </h3>
                  <p className="text-muted-foreground">{sponsor.about}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function ImagesSection({
  images,
  background = "muted",
}: {
  images: Image[];
  background?: "muted" | "default";
}) {
  return (
    <Section variant="big" background={background}>
      <div className="container flex flex-col gap-8">
        <h2 className="text-3xl font-bold md:text-center">Event Photos</h2>
        <div
          className={clsx(
            "mx-auto grid grid-cols-1 gap-4 overflow-y-auto max-h-[648px] max-w-[1280px] p-4 rounded-lg shadow",
            {
              "bg-background": background === "muted",
              "bg-muted": background === "default",
              "sm:grid-cols-2": images.length >= 2,
              "md:grid-cols-3": images.length >= 3,
              "lg:grid-cols-4": images.length >= 4,
            },
          )}
        >
          {images.map((image) => (
            <Link
              key={image.url}
              href={image.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block hover:opacity-75 transition-opacity"
            >
              <NextImage
                src={image.url}
                placeholder={image.placeholder ? "blur" : undefined}
                blurDataURL={image.placeholder || undefined}
                width={400}
                height={256}
                alt={image.alt}
                className="w-full h-64 object-cover rounded-lg"
                sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
              />
            </Link>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function EventDetailsPage({
  children,
  event,
  isAtCapacity,
  isInPast,
}: {
  children?: React.ReactNode;
  event: ExpandedEvent;
  isAtCapacity: boolean;
  isInPast: boolean;
}) {
  return (
    <PageLayout>
      {isAtCapacity && !isInPast && (
        <div className="px-4 lg:px-6">
          <Alert variant="default">
            <AlertCircleIcon className="h-6 w-6 text-destructive pr-2" />
            <AlertTitle>Registration closed</AlertTitle>
            <AlertDescription>
              This event is fully booked! Join the waitlist to be notified if
              any spots open up. We appreciate your interest!
            </AlertDescription>
          </Alert>
        </div>
      )}
      {isInPast && (
        <div className="px-4 lg:px-6">
          <Alert>
            <InfoIcon className="h-4 w-4" />
            <AlertTitle>Past event</AlertTitle>
            <AlertDescription>
              This event has ended. Thank you for joining us!
            </AlertDescription>
          </Alert>
        </div>
      )}
      {event.isDraft && (
        <div className="px-4 lg:px-6">
          <Alert>
            <InfoIcon className="h-4 w-4" />
            <AlertTitle>Draft event</AlertTitle>
            <AlertDescription>
              This event is still in draft mode. Please hold off on sharing it
              on your socials and stay tuned for updates!
            </AlertDescription>
          </Alert>
        </div>
      )}
      {children}
    </PageLayout>
  );
}
