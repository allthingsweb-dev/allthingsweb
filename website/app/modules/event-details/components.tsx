import {
  AlertCircleIcon,
  CalendarHeart,
  InfoIcon,
  UsersIcon,
} from "lucide-react";
import { MapPinIcon } from "../components/ui/icons";
import { toReadableDateTimeStr, toWeekdayStr } from "../datetime";
import { deserializeEvent, Event } from "../pocketbase/pocketbase";
import { NavLink, useLoaderData } from "@remix-run/react";
import { loader } from "./loader.sever";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Section } from "../components/ui/section";
import clsx from "clsx";
import { PageLayout } from "../components/page-layout";

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
                ? "Spots available"
                : !isInPast && attendeeCount >= attendeeLimit
                ? "At capacity"
                : "Event has ended"}
            </h3>
            <p className="text-lg lg:text-xl text-muted-foreground text-nowrap">
              {attendeeCount} / {attendeeLimit} guests registered
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <MapPinIcon className="h-12 w-12 text-primary" />
          <div>
            <h3 className="text-xl lg:text-2xl xl:text-3xl font-medium">
              {event.shortLocation}
            </h3>
            <p className="text-lg lg:text-xl text-muted-foreground text-nowrap">
              {event.streetAddress}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <CalendarHeart className="h-12 w-12 text-primary" />
          <div>
            <h3 className="text-xl lg:text-2xl xl:text-3xl font-medium">
              {toWeekdayStr(event.start)}
            </h3>
            <p className="text-lg lg:text-xl text-muted-foreground text-nowrap">
              {toReadableDateTimeStr(event.start, true)}
            </p>
          </div>
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
  const event = deserializeEvent(eventData);
  return (
    <PageLayout>
      {isAtCapacity && !isInPast && (
        <div className="px-4 lg:px-6">
          <Alert variant="destructive">
            <AlertCircleIcon className="h-6 w-6 text-destructive pr-2" />
            <AlertTitle>Registration closed</AlertTitle>
            <AlertDescription>
              We are full. Please check back later for possible openings or
              future events. Thank you for your interest!
            </AlertDescription>
          </Alert>
        </div>
      )}
      {isInPast && (
        <div className="px-4 lg:px-6">
          <Alert>
            <InfoIcon className="h-6 w-6 text-primary pr-2" />
            <AlertTitle>Past event</AlertTitle>
            <AlertDescription>
              This event has ended. Thank you for joining us!
            </AlertDescription>
          </Alert>
        </div>
      )}
      <Section variant="big">
        <div className="container px-4 md:px-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_400px] lg:gap-12 xl:grid-cols-[1fr_600px]">
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
                <NavLink
                  to={
                    event.enableRegistrations
                      ? `/${event.slug}/register`
                      : event.lumaUrl
                  }
                  className={clsx(
                    "mr-auto md:mr-0 inline-flex h-10 items-center justify-center rounded-md px-8 text-sm font-medium shadow transition-colors bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    {
                      "pointer-events-none opacity-50": isRegistrationDisabled,
                    }
                  )}
                  prefetch="intent"
                  aria-disabled={isRegistrationDisabled}
                >
                  {event.enableRegistrations
                    ? "Register now"
                    : "Register on Luma"}
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
