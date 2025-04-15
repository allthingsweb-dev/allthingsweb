import { data, useLoaderData } from "react-router";
import cachified from "@epic-web/cachified";
import {
  ArrowRightIcon,
  CalendarIcon,
  MapPinIcon,
  UsersIcon,
} from "lucide-react";
import type { Event } from "~/modules/allthingsweb/events";
import { ButtonAnchor, ButtonNavLink } from "~/modules/components/ui/button";
import { EventsCarousel } from "~/modules/event-carousel/components";
import { PageLayout } from "~/modules/components/page-layout";
import { Section } from "~/modules/components/ui/section";
import { toReadableDateTimeStr } from "~/modules/datetime";
import { getMetaTags } from "~/modules/meta";
import { lru } from "~/modules/cache";
import { DiscordLogoIcon } from "~/modules/components/ui/icons";
import { Route } from "./+types/_index";
import { Image } from "~/modules/allthingsweb/images";
import { Img } from "openimg/react";
import { getPastEventImages } from "~/modules/homepage/homepage";
import { CodeBlock } from "~/modules/components/ui/code-block";

export { headers } from "~/modules/header.server";

export const meta: Route.MetaFunction = ({ matches }) => {
  const rootMatch = matches.find((match) => match && match.id === "root");
  if (!rootMatch || !rootMatch.meta) {
    return [{ title: "Something went wrong" }];
  }
  if (!rootMatch.data) {
    return [{ title: "Something went wrong" }, ...rootMatch.meta];
  }
  const rootData = (rootMatch as Route.MetaArgs["matches"][0]).data;
  return getMetaTags(
    "All Things Web",
    "Discover exciting web development events in the Bay Area and San Francisco.",
    `${rootData.serverOrigin}/`,
    `${rootData.serverOrigin}/img?src=${rootData.serverOrigin}/preview.png&w=1200&h=630&format=webp`,
  );
};

const CLI_INSTALL_COMMAND =
  "curl -LSs https://allthingsweb-dev.github.io/allthingsweb/atw-install.bash | bash";

export async function loader({ context }: Route.LoaderArgs) {
  const { time, getServerTimingHeader } = context.serverTimingsProfiler;

  const {
    highlightEvent,
    remainingEvents,
    liveEvents,
    pastEvents,
    pastEventImages,
    cliInstallCommand,
  } = await cachified({
    key: "_index-loader-data",
    cache: lru,
    // Use cached value for 3 minutes, after one minute, fetch fresh value in the background
    // Downstream is only hit once a minute
    ttl: 60 * 1000, // one minute
    staleWhileRevalidate: 2 * 60 * 1000, // two minutes
    getFreshValue: async () => {
      const [
        events,
        liveEvents,
        pastEvents,
        pastEventImages,
        cliInstallCommand,
      ] = await Promise.all([
        time(
          "getUpcomingEvents",
          context.queryClient.getPublishedUpcomingEvents,
        ),
        time("getLiveEvents", context.queryClient.getPublishedLiveEvents),
        time("getPastEvents", context.queryClient.getPublishedPastEvents),
        time(
          "getPastEventImages",
          getPastEventImages({ db: context.db, s3Client: context.s3Client }),
        ),
        context.formatter.formatCode(CLI_INSTALL_COMMAND, "bash"),
      ]);
      const highlightEvent = events.find(
        (event) => event.highlightOnLandingPage,
      );
      const remainingEvents = events.filter(
        (event) => event.id !== highlightEvent?.id,
      );

      return {
        highlightEvent,
        remainingEvents,
        liveEvents,
        pastEvents,
        pastEventImages,
        cliInstallCommand,
      };
    },
  });

  return data(
    {
      highlightEvent,
      remainingEvents,
      liveEvents,
      pastEvents,
      pastEventImages,
      cliInstallCommand,
    },
    {
      headers: getServerTimingHeader(),
    },
  );
}

export default function Component() {
  const {
    highlightEvent,
    remainingEvents,
    liveEvents,
    pastEvents,
    pastEventImages,
    cliInstallCommand,
  } = useLoaderData<typeof loader>();

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
                <ButtonNavLink to={`/${liveEvents[0].slug}`}>
                  See details
                  <ArrowRightIcon className="ml-2 h-4 w-4" />
                </ButtonNavLink>
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
                <ButtonNavLink to={`/${highlightEvent.slug}`}>
                  See details
                  <ArrowRightIcon className="ml-2 h-4 w-4" />
                </ButtonNavLink>
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
      <CliSection
        cliInstallCommand={cliInstallCommand}
        background={remainingEvents.length > 0 ? "muted" : "default"}
      />
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
              <ButtonAnchor
                className="inline-flex h-9 items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-indigo-600 shadow transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-950 disabled:pointer-events-none disabled:opacity-50"
                href="https://discord.gg/B3Sm4b5mfD"
                target="_blank"
                rel="noopener noreferrer"
              >
                <DiscordLogoIcon className="mr-2 h-4 w-4" />
                Join Discord
              </ButtonAnchor>
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
      <div className="w-full grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-1">
        {images.map((image) => (
          <Img
            key={image.url}
            src={image.url}
            placeholder={image.placeholder || undefined}
            width={800}
            height={800}
            className="object-cover w-full max-w-[800px] h-auto"
            isAboveFold
          />
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

function CliSection({
  cliInstallCommand,
  background = "default",
}: {
  cliInstallCommand: string;
  background?: "default" | "muted";
}) {
  return (
    <Section variant="big" background={background}>
      <div className="container">
        <div className="flex flex-col items-center space-y-4 text-center">
          <div className="space-y-2">
            <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
              Bored of navigating Luma?
            </h2>
            <p className="max-w-[900px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
              Use our CLI tool to RSVP for upcoming events directly in your
              terminal:
            </p>
          </div>
          <div className="w-full max-w-[860px] mt-4">
            <CodeBlock html={cliInstallCommand} code={CLI_INSTALL_COMMAND} />
          </div>
        </div>
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
          <ButtonNavLink
            to="/speakers"
            className="inline-flex items-center justify-center"
            variant="outline"
          >
            <UsersIcon className="mr-2 h-4 w-4" />
            View all speakers
          </ButtonNavLink>
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
