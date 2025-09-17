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
import type { ExpandedEvent, Talk, Sponsor } from "@/lib/expanded-events";
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
    <div className="flex flex-col justify-center space-y-6 lg:space-y-4">
      <div className="space-y-3 lg:space-y-2">
        <h1 className="text-2xl font-bold tracking-tighter sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl/none">
          {event.name}
        </h1>
        <p className="max-w-[600px] text-muted-foreground text-base sm:text-lg md:text-xl leading-relaxed">
          {event.tagline}
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 lg:items-start">
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
          <Button
            asChild
            variant={isInPast ? "outline" : "default"}
            size="lg"
            className="w-full min-[400px]:w-auto"
          >
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
        <div className="flex flex-col lg:flex-row items-center justify-center gap-8 lg:gap-12 xl:gap-24 xl2:gap-32">
          {!!children ? (
            children
          ) : (
            <>
              <div className="text-center lg:text-left">
                <HeroSectionTitle
                  event={event}
                  isAtCapacity={isAtCapacity}
                  isInPast={isInPast}
                />
              </div>
              <div className="w-full max-w-md lg:max-w-[400px] xl:max-w-[600px] lg:flex-1">
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
      <div className="container">
        <div className="flex flex-col gap-6 sm:gap-8 lg:items-center lg:justify-center lg:flex-row lg:gap-12 xl:gap-16">
          <h2 className="text-2xl font-bold text-center lg:sr-only mb-2 lg:mb-0">
            All you need to know
          </h2>
          <div className="flex gap-3 sm:gap-4 flex-col items-center text-center">
            <UsersIcon className="h-10 w-10 sm:h-12 sm:w-12 text-primary flex-shrink-0 mt-1 lg:mt-0" />
            <div className="min-w-0 flex-1">
              <h3 className="text-lg sm:text-xl lg:text-2xl xl:text-3xl font-medium leading-tight">
                {!isInPast && attendeeCount < attendeeLimit
                  ? "Spots available"
                  : !isInPast && attendeeCount >= attendeeLimit
                    ? "At capacity"
                    : "Event has ended"}
              </h3>
              <p className="text-sm sm:text-base lg:text-lg xl:text-xl text-muted-foreground mt-1">
                {attendeeCount} / {attendeeLimit} guests registered
              </p>
            </div>
          </div>
          <div className="flex gap-3 sm:gap-4 flex-col items-center text-center">
            <MapPinIcon className="h-10 w-10 sm:h-12 sm:w-12 text-primary flex-shrink-0 mt-1 lg:mt-0" />
            <div className="min-w-0 flex-1">
              <h3 className="text-lg sm:text-xl lg:text-2xl xl:text-3xl font-medium leading-tight">
                {event.shortLocation}
              </h3>
              <p className="text-sm sm:text-base lg:text-lg xl:text-xl text-muted-foreground mt-1 break-words">
                {event.streetAddress}
              </p>
            </div>
          </div>
          <div className="flex gap-3 sm:gap-4 flex-col items-center text-center">
            <CalendarIcon className="h-10 w-10 sm:h-12 sm:w-12 text-primary flex-shrink-0 mt-1 lg:mt-0" />
            <div className="min-w-0 flex-1">
              <h3 className="text-lg sm:text-xl lg:text-2xl xl:text-3xl font-medium leading-tight">
                {toWeekdayStr(event.startDate)}
              </h3>
              <p className="text-sm sm:text-base lg:text-lg xl:text-xl text-muted-foreground mt-1">
                {toReadableDateTimeStr(event.startDate, false)}
              </p>
            </div>
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
        <h2 className="text-2xl sm:text-3xl font-bold text-center tracking-tight">
          Talks
        </h2>
        <div
          className={clsx("mx-auto grid gap-6 grid-cols-1 max-w-4xl", {
            "lg:grid-cols-2": talks.length >= 2,
          })}
        >
          {talks.map((talk) => (
            <Card key={talk.id} className="flex flex-col h-full">
              <CardHeader className="pb-4">
                <div className="flex items-start space-x-3 sm:space-x-4">
                  <Avatar className="w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0">
                    <AvatarImage
                      src={talk.speakers[0].image.url}
                      alt={talk.speakers[0].name}
                    />
                    <AvatarFallback className="text-sm">
                      {talk.speakers[0].name}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base sm:text-lg leading-tight">
                      {talk.speakers[0].name}
                    </CardTitle>
                    <CardDescription className="text-sm sm:text-base mt-1">
                      {talk.speakers[0].title}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-grow flex flex-col items-start gap-4 pt-0">
                <h4 className="text-lg sm:text-xl font-semibold leading-tight">
                  {talk.title}
                </h4>
                <div
                  className={clsx(
                    "text-muted-foreground flex flex-col gap-2 text-sm sm:text-base",
                    "[&_a]:text-primary hover:[&_a]:text-primary/80 [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-2 [&_a]:decoration-primary hover:[&_a]:decoration-primary/80 focus-visible:[&_a]:outline-none focus-visible:[&_a]:ring-1 focus-visible:[&_a]:ring-ring",
                    "[&_ul]:list-inside [&_ul]:list-disc [&_li]:mb-1",
                    "[&_p]:mb-2 [&_p:last-child]:mb-0",
                  )}
                  dangerouslySetInnerHTML={{ __html: talk.description }}
                />
                <div className="flex-grow flex flex-col items-start gap-2 w-full">
                  <h4 className="font-semibold text-sm sm:text-base">
                    About the Speaker
                  </h4>
                  <p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
                    {talk.speakers[0].bio}
                  </p>
                </div>
              </CardContent>
              <CardFooter className="pt-4">
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
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-6 sm:mb-8">
          {sponsors.length === 1
            ? "Our Host & Sponsor"
            : "Our Hosts & Sponsors"}
        </h2>
        <div className="flex flex-col gap-6 md:gap-8 items-center justify-center max-w-4xl mx-auto">
          {sponsors.map((sponsor) => (
            <div
              key={sponsor.id}
              className="bg-background rounded-lg shadow-lg p-6 sm:p-8 w-full"
            >
              <div className="flex flex-col sm:flex-row items-center text-center sm:text-left space-y-4 sm:space-y-0 sm:space-x-6">
                <NextImage
                  src={sponsor.squareLogoLight.url}
                  width={96}
                  height={96}
                  alt={sponsor.name}
                  className="w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 object-contain flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <h3 className="text-xl sm:text-2xl font-semibold mb-3 sm:mb-4">
                    {sponsor.name}
                  </h3>
                  <p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
                    {sponsor.about}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function TeamsAndHacksSection({
  hacks,
}: {
  hacks: NonNullable<ExpandedEvent["hacks"]>;
}) {
  if (!hacks.length) return null;
  return (
    <Section id="hacks" variant="big">
      <div className="container flex flex-col gap-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-center tracking-tight">
          Teams & Hacks
        </h2>
        <div
          className={clsx(
            "mx-auto grid gap-6 grid-cols-1 max-w-5xl",
            "sm:grid-cols-2",
          )}
        >
          {hacks.map((hack) => (
            <Card key={hack.id} className="flex flex-col h-full">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  {hack.teamImage ? (
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={hack.teamImage.url} alt={hack.teamName} />
                      <AvatarFallback>{hack.teamName[0]}</AvatarFallback>
                    </Avatar>
                  ) : (
                    <Avatar className="w-10 h-10">
                      <AvatarFallback>{hack.teamName[0]}</AvatarFallback>
                    </Avatar>
                  )}
                  <div className="min-w-0">
                    <CardTitle className="text-base leading-tight truncate">
                      {hack.teamName}
                    </CardTitle>
                    {hack.projectName && (
                      <CardDescription className="text-sm mt-1 truncate">
                        {hack.projectName}
                      </CardDescription>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {hack.projectDescription && (
                  <p className="text-muted-foreground text-sm line-clamp-4">
                    {hack.projectDescription}
                  </p>
                )}
              </CardContent>
              <CardFooter>
                <div className="text-sm text-muted-foreground">Votes: {hack.voteCount}</div>
              </CardFooter>
            </Card>
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
      <div className="container flex flex-col gap-6 sm:gap-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-center">
          Event Photos
        </h2>
        <div
          className={clsx(
            "mx-auto grid grid-cols-1 gap-3 sm:gap-4 overflow-y-auto max-h-[600px] sm:max-h-[648px] max-w-[1280px] p-3 sm:p-4 rounded-lg shadow-sm",
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
              className="block hover:opacity-75 transition-opacity duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-lg"
            >
              <NextImage
                src={image.url}
                placeholder={image.placeholder ? "blur" : undefined}
                blurDataURL={image.placeholder || undefined}
                width={400}
                height={256}
                alt={image.alt}
                className="w-full h-48 sm:h-56 md:h-64 object-cover rounded-lg"
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
