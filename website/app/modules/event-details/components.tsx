import { NavLink, useLoaderData } from '@remix-run/react';
import { AlertCircleIcon, CalendarHeart, InfoIcon, UsersIcon } from 'lucide-react';
import clsx from 'clsx';
import { Avatar, AvatarFallback, AvatarImage } from '~/modules/components/ui/avatar';
import { MapPinIcon, LinkedInLogoIcon, TwitterLogoIcon } from '~/modules/components/ui/icons';
import { Alert, AlertDescription, AlertTitle } from '~/modules/components/ui/alert';
import { toReadableDateTimeStr, toWeekdayStr } from '~/modules/datetime';
import { Section } from '~/modules/components/ui/section';
import { PageLayout } from '~/modules/components/page-layout';
import { deserializeExpandedEvent, Event, ExpandedTalk, Sponsor } from '~/modules/pocketbase/pocketbase';
import { loader } from './loader.sever';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card';

export function AllYouNeedToKnowSection({
  event,
  attendeeLimit,
  attendeeCount,
  isInPast,
}: {
  event: Event;
  attendeeLimit: number;
  attendeeCount: number;
  isInPast: boolean;
}) {
  return (
    <Section variant="big" background="muted">
      <div className="w-full px-4 md:px-6 flex flex-col md:items-center justify-center lg:flex-row gap-12 lg:gap-24 xl:gap-32 2xl:gap-44">
        <h2 className="sr-only">All you need to know</h2>
        <div className="flex md:items-center gap-4">
          <UsersIcon className="h-12 w-12 text-primary" />
          <div>
            <h3 className="text-xl lg:text-2xl xl:text-3xl font-medium">
              {!isInPast && attendeeCount < attendeeLimit
                ? 'Spots available'
                : !isInPast && attendeeCount >= attendeeLimit
                  ? 'At capacity'
                  : 'Event has ended'}
            </h3>
            <p className="text-lg lg:text-xl text-muted-foreground text-nowrap">
              {attendeeCount} / {attendeeLimit} guests registered
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <MapPinIcon className="h-12 w-12 text-primary" />
          <div>
            <h3 className="text-xl lg:text-2xl xl:text-3xl font-medium">{event.shortLocation}</h3>
            <p className="text-lg lg:text-xl text-muted-foreground text-nowrap">{event.streetAddress}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <CalendarHeart className="h-12 w-12 text-primary" />
          <div>
            <h3 className="text-xl lg:text-2xl xl:text-3xl font-medium">{toWeekdayStr(event.start)}</h3>
            <p className="text-lg lg:text-xl text-muted-foreground text-nowrap">
              {toReadableDateTimeStr(event.start, true)}
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}

export function TalksSection({ talks }: { talks: ExpandedTalk[] }) {
  return (
    <Section id="talks" variant="big">
      <div className="container mx-auto px-4">
        <h2 className="text-3xl font-bold text-center tracking-tight mb-8">Talks</h2>
        <div className="grid gap-8 md:grid-cols-2">
          {talks.map((talk) => (
            <Card key={talk.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-center space-x-4 mb-2">
                  <Avatar className="w-12 h-12">
                    <AvatarImage src={talk.speaker.profileImage} alt={talk.speaker.name} />
                    <AvatarFallback>{talk.speaker.name}</AvatarFallback>
                  </Avatar>
                  <div>
                    <CardTitle>{talk.speaker.name}</CardTitle>
                    <CardDescription>{talk.speaker.title}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-grow flex flex-col items-start gap-4">
                <h4 className="text-2xl">{talk.title}</h4>
                <div
                  className="text-muted-foreground flex flex-col gap-2"
                  dangerouslySetInnerHTML={{ __html: talk.description }}
                />
                <div className="flex-grow flex flex-col items-start gap-2">
                  <h4 className="font-semibold">About the Speaker</h4>
                  <p className="text-muted-foreground">{talk.speaker.bio}</p>
                </div>
              </CardContent>
              <CardFooter>
                <div className="flex justify-start gap-2 items-center">
                  {talk.speaker.twitterUrl && (
                    <a href={talk.speaker.twitterUrl} target="_blank" rel="noopener noreferrer">
                      <TwitterLogoIcon className="h-4 w-4" />
                      <span className="sr-only">Twitter</span>
                    </a>
                  )}
                  {talk.speaker.linkedinUrl && (
                    <a href={talk.speaker.linkedinUrl} target="_blank" rel="noopener noreferrer">
                      <LinkedInLogoIcon className="h-5 w-5" />
                      <span className="sr-only">LinkedIn</span>
                    </a>
                  )}
                </div>
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
      <div className="container px-4 md:px-6 mx-auto max-w-4xl">
        <h2 className="text-3xl font-bold md:text-center mb-8">
          {sponsors.length === 1 ? 'Event Sponsor' : 'Event Sponsors'}
        </h2>
        <div className="flex flex-col gap-4 md:gap-8 items-center justify-center">
          {sponsors.map((sponsor) => (
            <div key={sponsor.id} className="bg-background rounded-lg shadow-lg p-8 max-w-3xl mx-auto">
              <div className="flex flex-col md:flex-row items-center space-y-6 md:space-y-0 md:space-x-8">
                <img src={sponsor.rectangularLogo} className="w-12" alt={sponsor.name} />
                <div className="text-left">
                  <h3 className="text-2xl font-semibold mb-4">{sponsor.name}</h3>
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

export function EventDetailsPage({ children }: { children?: React.ReactNode }) {
  const {
    event: eventData,
    isAtCapacity,
    attendeeCount,
    attendeeLimit,
    isInPast,
    isRegistrationDisabled,
  } = useLoaderData<typeof loader>();
  const event = deserializeExpandedEvent(eventData);
  return (
    <PageLayout>
      {isAtCapacity && !isInPast && (
        <div className="px-4 lg:px-6">
          <Alert variant="destructive">
            <AlertCircleIcon className="h-6 w-6 text-destructive pr-2" />
            <AlertTitle>Registration closed</AlertTitle>
            <AlertDescription>
              We are full. Please check back later for possible openings or future events. Thank you for your interest!
            </AlertDescription>
          </Alert>
        </div>
      )}
      {isInPast && (
        <div className="px-4 lg:px-6">
          <Alert>
            <InfoIcon className="h-6 w-6 text-primary pr-2" />
            <AlertTitle>Past event</AlertTitle>
            <AlertDescription>This event has ended. Thank you for joining us!</AlertDescription>
          </Alert>
        </div>
      )}
      <Section variant="big">
        <div className="container px-4 md:px-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_400px] lg:gap-12 xl:grid-cols-[1fr_600px]">
            <div className="flex flex-col justify-center space-y-4">
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tighter sm:text-5xl xl:text-6xl/none">{event.name}</h1>
                <p className="max-w-[600px] text-muted-foreground md:text-xl">{event.tagline}</p>
              </div>
              <div className="flex flex-col gap-2 min-[400px]:flex-row">
                <NavLink
                  to={event.enableRegistrations ? `/${event.slug}/register?utm_source=web` : event.lumaUrl}
                  className={clsx(
                    'mr-auto md:mr-0 inline-flex h-10 items-center justify-center rounded-md px-8 text-sm font-medium shadow transition-colors bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    {
                      'pointer-events-none opacity-50': isRegistrationDisabled,
                    },
                  )}
                  prefetch="intent"
                  aria-disabled={isRegistrationDisabled}
                >
                  {event.enableRegistrations ? 'Register now' : 'Register on Luma'}
                </NavLink>
              </div>
            </div>
            <img
              src="/hero-image-hackathon.png"
              width="550"
              height="550"
              alt="Hero"
              className="mx-auto aspect-video overflow-hidden rounded-xl object-cover sm:w-full lg:order-last lg:aspect-square"
            />
          </div>
        </div>
      </Section>
      <AllYouNeedToKnowSection
        event={event}
        attendeeCount={attendeeCount}
        attendeeLimit={attendeeLimit}
        isInPast={isInPast}
      />
      {children}
    </PageLayout>
  );
}
