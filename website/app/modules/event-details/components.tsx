import { NavLink, useLoaderData } from '@remix-run/react';
import clsx from 'clsx';
import { AlertCircleIcon, CalendarHeart, InfoIcon, UsersIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '~/modules/components/ui/avatar';
import { MapPinIcon, LinkedInLogoIcon, TwitterLogoIcon } from '~/modules/components/ui/icons';
import { Alert, AlertDescription, AlertTitle } from '~/modules/components/ui/alert';
import { toReadableDateTimeStr, toWeekdayStr } from '~/modules/datetime';
import { Section } from '~/modules/components/ui/section';
import { PageLayout } from '~/modules/components/page-layout';
import { deserializeExpandedEvent, Event, ExpandedTalk, Sponsor } from '~/modules/pocketbase/pocketbase';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '~/modules/components/ui/card';
import { getImageSrc } from '~/modules/image-opt/utils';
import { ButtonNavLink } from '~/modules/components/ui/button';
import { loader } from './loader.sever';

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
      <div className="container flex flex-col gap-8">
        <h2 className="text-3xl font-bold text-center tracking-tight">Talks</h2>
        <div
          className={clsx('mx-auto grid gap-4 grid-cols-[repeat(1,minmax(auto,800px))]', {
            'lg:grid-cols-[repeat(2,minmax(auto,800px))]': talks.length >= 2,
          })}
        >
          {talks.map((talk) => (
            <Card key={talk.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-center space-x-4 mb-2">
                  <Avatar className="w-12 h-12">
                    <AvatarImage
                      width={48}
                      height={48}
                      src={getImageSrc(talk.speaker.profileImageUrl, { width: 48, height: 48 })}
                      alt={talk.speaker.name}
                      loading="lazy"
                    />
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
                  className={clsx(
                    'text-muted-foreground flex flex-col gap-2',
                    '[&_a]:text-primary hover:[&_a]:text-primary/80 [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-2 [&_a]:decoration-primary hover:[&_a]:decoration-primary/80 focus-visible:[&_a]:outline-none focus-visible:[&_a]:ring-1 focus-visible:[&_a]:ring-ring',
                    '[&_ul]:list-inside [&_ul]:list-disc',
                  )}
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
                    <a
                      href={talk.speaker.twitterUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <TwitterLogoIcon className="h-4 w-4" />
                      <span className="sr-only">Twitter</span>
                    </a>
                  )}
                  {talk.speaker.linkedinUrl && (
                    <a
                      href={talk.speaker.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
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
      <div className="container">
        <h2 className="text-3xl font-bold md:text-center mb-8">
          {sponsors.length === 1 ? 'Event Sponsor' : 'Event Sponsors'}
        </h2>
        <div className="flex flex-col gap-4 md:gap-8 items-center justify-center">
          {sponsors.map((sponsor) => (
            <div key={sponsor.id} className="bg-background rounded-lg shadow-lg p-8 max-w-3xl mx-auto">
              <div className="flex flex-col md:flex-row items-center space-y-6 md:space-y-0 md:space-x-8">
                <img
                  src={getImageSrc(sponsor.squareLogo, { width: 40, height: 40 })}
                  width={48}
                  height={48}
                  className="w-12"
                  alt={sponsor.name}
                  loading="lazy"
                />
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

export function PhotosSection({
  photos,
  background = 'muted',
}: {
  photos: string[];
  background?: 'muted' | 'default';
}) {
  return (
    <Section variant="big" background={background}>
      <div className="container flex flex-col gap-8">
        <h2 className="text-3xl font-bold md:text-center">Event Photos</h2>
        <div
          className={clsx(
            'mx-auto grid grid-cols-1 gap-4 overflow-y-auto max-h-[648px] max-w-[1280px] p-4 rounded-lg shadow',
            {
              'bg-background': background === 'muted',
              'bg-muted': background === 'default',
              'sm:grid-cols-2': photos.length >= 2,
              'md:grid-cols-3': photos.length >= 3,
              'lg:grid-cols-4': photos.length >= 4,
            },
          )}
        >
          {photos.map((photoUrl) => (
            <NavLink
              key={photoUrl}
              to={photoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block hover:opacity-75 transition-opacity"
            >
              <img
                src={getImageSrc(photoUrl, { width: 300, height: 300, fit: 'cover' })}
                width={300}
                height={300}
                alt="Event photo"
                className="rounded-lg h-[300px] w-[300px] object-cover"
                loading="lazy"
              />
            </NavLink>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function EventDetailsPage({ children }: { children?: React.ReactNode }) {
  const { event: eventData, isAtCapacity, attendeeCount, attendeeLimit, isInPast } = useLoaderData<typeof loader>();
  const event = deserializeExpandedEvent(eventData);
  return (
    <PageLayout>
      {isAtCapacity && !isInPast && (
        <div className="px-4 lg:px-6">
          <Alert variant="default">
            <AlertCircleIcon className="h-6 w-6 text-destructive pr-2" />
            <AlertTitle>Registration closed</AlertTitle>
            <AlertDescription>
              This event is fully booked! Join the waitlist to be notified if any spots open up. We appreciate your
              interest!
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
      {event.isDraft && (
        <div className="px-4 lg:px-6">
          <Alert>
            <InfoIcon className="h-6 w-6 text-primary pr-2" />
            <AlertTitle>Draft event</AlertTitle>
            <AlertDescription>
              This event is still in draft mode. Please hold off on sharing it on your socials and stay tuned for
              updates!
            </AlertDescription>
          </Alert>
        </div>
      )}
      <Section variant="first">
        <div className="container">
          <div className="grid gap-6 lg:grid-cols-[1fr_400px] lg:gap-12 xl:grid-cols-[1fr_600px]">
            <div className="flex flex-col justify-center space-y-4">
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tighter sm:text-5xl xl:text-6xl/none">{event.name}</h1>
                <p className="max-w-[600px] text-muted-foreground md:text-xl">{event.tagline}</p>
              </div>
              {event.lumaUrl && (
                <div className="flex flex-col gap-2 min-[400px]:flex-row">
                  <ButtonNavLink variant="default" size="lg" to={event.lumaUrl}>
                    {isInPast ? 'View on Luma' : isAtCapacity ? 'Join waitlist on Luma' : 'Register on Luma'}
                  </ButtonNavLink>
                </div>
              )}
            </div>
            <img
              src={getImageSrc(
                event.isHackathon ? '/img/public/hero-image-hackathon.png' : '/img/public/hero-image-meetup.png',
                { width: 550, height: 550, fit: 'cover' },
              )}
              width="550"
              height="550"
              alt={
                event.isHackathon
                  ? 'Four cartoon-style developers cheerfully throwing their arms up, surrounded by confetti. In the center, a desk with a laptop displaying code.'
                  : 'A group of cartoon-style developers standing in a circle, chatting and laughing together.'
              }
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
