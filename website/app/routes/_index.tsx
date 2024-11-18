import { useLoaderData } from '@remix-run/react';
import { LoaderFunctionArgs, MetaFunction, json } from '@remix-run/node';
import cachified from '@epic-web/cachified';
import { ArrowRightIcon, CalendarIcon, MapPinIcon, UsersIcon } from 'lucide-react';
import { type loader as rootLoader } from '~/root';
import { deserializeEvent, Event } from '~/modules/pocketbase/pocketbase';
import { ButtonAnchor, ButtonNavLink } from '~/modules/components/ui/button';
import { EventsCarousel } from '~/modules/event-carousel/components';
import { PageLayout } from '~/modules/components/page-layout';
import { Section } from '~/modules/components/ui/section';
import { toReadableDateTimeStr } from '~/modules/datetime';
import { getMetaTags, mergeMetaTags } from '~/modules/meta';
import { lru } from '~/modules/cache';
import { getImageSrc } from '~/modules/image-opt/utils';

export { headers } from '~/modules/header.server';

export const meta: MetaFunction<typeof loader, { root: typeof rootLoader }> = ({ matches }) => {
  const rootLoaderData = matches.find((match) => match.id === 'root')?.data;
  if (!rootLoaderData) {
    return mergeMetaTags([{ title: 'Something went wrong' }], matches);
  }
  return mergeMetaTags(
    getMetaTags(
      'All Things Web',
      'Discover exciting web development events in the Bay Area and San Francisco.',
      `${rootLoaderData.serverOrigin}/`,
      `${rootLoaderData.serverOrigin}/img/gen/preview.png`,
    ),
    matches,
  );
};

export async function loader({ context }: LoaderFunctionArgs) {
  const { time, getServerTimingHeader } = context.serverTimingsProfiler;
  const { highlightEvent, remainingEvents, pastEvents } = await cachified({
    key: '_index-loader-data',
    cache: lru,
    // Use cached value for 3 minutes, after one minute, fetch fresh value in the background
    // Downstream is only hit once a minute
    ttl: 60 * 1000, // one minute
    staleWhileRevalidate: 2 * 60 * 1000, // two minutes
    getFreshValue: async () => {
      const [events, pastEvents] = await Promise.all([
        time('getUpcomingEvents', context.pocketBaseClient.getUpcomingEvents),
        time('getPastEvents', context.pocketBaseClient.getPastEvents),
      ]);
      const highlightEvent = events.find((event) => event.highlightOnLandingPage);
      const remainingEvents = events.filter((event) => event.id !== highlightEvent?.id);

      return {
        highlightEvent,
        remainingEvents,
        pastEvents,
      };
    },
  });

  let eventPhotos: string[] = [];
  let loopCounter = 0;
  // Get even number of photos from each event
  while (eventPhotos.length < 30) {
    const shuffledPastEvents = pastEvents.toSorted(() => Math.random() - 0.5);
    for (const event of shuffledPastEvents) {
      if (event.photos[loopCounter]) {
        eventPhotos.push(event.photos[loopCounter]);
      }
      if (eventPhotos.length >= 30) {
        break;
      }
    }
    loopCounter++;
  }

  return json(
    {
      highlightEvent,
      remainingEvents,
      pastEvents,
      pastEventImages: eventPhotos,
    },
    {
      headers: getServerTimingHeader(),
    },
  );
}

export default function Component() {
  const {
    highlightEvent: highlightEventData,
    remainingEvents: remainingEventsData,
    pastEvents: pastEventsData,
    pastEventImages,
  } = useLoaderData<typeof loader>();
  const highlightEvent = highlightEventData ? deserializeEvent(highlightEventData) : null;
  const remainingEvents = remainingEventsData.map(deserializeEvent);
  const pastEvents = pastEventsData.map(deserializeEvent);

  return (
    <PageLayout>
      <LandingHero images={pastEventImages} />
      {highlightEvent && (
        <Section variant="big" background="muted">
          <div className="container">
            <div className="flex flex-col items-center space-y-4 text-center">
              <div className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
                  Join {highlightEvent.name}
                </h2>
                <p className="max-w-[900px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
                  {highlightEvent.tagline}
                </p>
              </div>
              <div className="flex justify-center items-center gap-4 text-muted-foreground md:text-xl lg:text-base xl:text-xl">
                <div className="flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4" />
                  <span>{toReadableDateTimeStr(highlightEvent.start, true)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPinIcon className="h-4 w-4" />
                  <span>{highlightEvent.shortLocation}</span>
                </div>
              </div>
              <div className="w-full max-w-sm pt-4">
                <ButtonNavLink to={`/${highlightEvent.slug}`}>
                  See details
                  <ArrowRightIcon className="ml-2 h-4 w-4" />
                </ButtonNavLink>
              </div>
            </div>
          </div>
        </Section>
      )}
      {remainingEvents.length > 0 && <OtherUpcomingEventsSection events={remainingEvents} />}
      <Section variant="big" className="bg-indigo-600 text-white">
        <div className="container">
          <div className="flex flex-col items-center space-y-4 text-center">
            <div className="space-y-2">
              <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">Join our Discord</h2>
              <p className="mx-auto max-w-[700px] text-gray-200 md:text-xl">
                Connect with fellow developers, share ideas, and stay updated on the latest events and opportunities.
              </p>
            </div>
            <div className="space-x-4">
              <ButtonAnchor
                className="inline-flex h-9 items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-indigo-600 shadow transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-950 disabled:pointer-events-none disabled:opacity-50"
                href="https://discord.gg/B3Sm4b5mfD"
                target="_blank"
                rel="noopener noreferrer"
              >
                <UsersIcon className="mr-2 h-4 w-4" />
                Join Discord
              </ButtonAnchor>
            </div>
          </div>
        </div>
      </Section>
      <PastEventsSection events={pastEvents.map(deserializeEvent)} />
    </PageLayout>
  );
}

function LandingHero({ images }: { images: string[] }) {
  return (
    <section className="w-full h-[80vh] overflow-hidden grid [&>*]:col-[1] [&>*]:row-[1]">
      <div className="w-full grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-1">
        {images.map((imageSrc) => (
          <img
            key={imageSrc}
            src={getImageSrc(imageSrc, { width: 400, height: 400, fit: 'cover' })}
            alt="Past event image"
            aria-hidden="true"
            width={400}
            height={400}
            className="w-full object-cover"
          />
        ))}
      </div>

      {/* Content */}
      <div className="z-20 bg-gradient-to-b from-black/70 to-black/30 flex flex-col items-center pt-[30vh] text-center text-white px-4">
        <h1 className="mb-4 text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight">All Things Web 🚀</h1>
        <p className="max-w-2xl text-lg sm:text-xl">
          Discover exciting web development events in the Bay Area and San Francisco. Join us for hackathons, hangouts,
          and meetups to connect with fellow developers and web enthusiasts.
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
          <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">Other events</h2>
          <p className="text-muted-foreground md:text-xl max-w-[700px]">
            Discover more upcoming web development events in the Bay Area here or on Luma.
          </p>
          <ButtonAnchor
            href="https://lu.ma/allthingsweb?utm_source=web"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center"
            variant="outline"
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            View events on Luma calendar
          </ButtonAnchor>
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
          <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl text-center mb-4">Past events</h2>
          <p className="text-muted-foreground md:text-xl max-w-[700px]">
            Find out what we&apos;ve been up to in the past. Check out our previous web development meetups and
            hackathons.
          </p>
          <ButtonNavLink to="/speakers" className="inline-flex items-center justify-center" variant="outline">
            <UsersIcon className="mr-2 h-4 w-4" />
            View all speakers
          </ButtonNavLink>
        </div>
        <EventsCarousel events={events} />
      </div>
    </Section>
  );
}
