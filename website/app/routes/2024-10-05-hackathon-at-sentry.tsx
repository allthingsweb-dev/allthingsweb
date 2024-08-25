import { HTMLAttributes } from "react";
import { MetaFunction } from "@remix-run/node";
import { NavLink, useLoaderData } from "@remix-run/react";
import { clsx } from "clsx";
import { UsersIcon, CalendarHeart, AlertCircleIcon, InfoIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { MapPinIcon, SentryLogoIcon } from "~/modules/components/ui/icons";
import { DefaultRightTopNav } from "~/modules/components/right-top-nav";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "~/modules/components/ui/alert";
import {
  getAttendeeCount,
  getEventBySlug,
} from "~/modules/pocketbase/api.server";
import { cn } from "~/modules/components/utils";
import { mergeMetaTags } from "~/modules/meta";
import {
  deserializeEvent,
  Event,
  isEventInPast,
} from "~/modules/pocketbase/pocketbase";

export const meta: MetaFunction<typeof loader> = ({ data, matches }) => {
  if (!data || !data.event) {
    return [{ title: "Event Not Found" }];
  }
  return mergeMetaTags(
    [
      { title: `${data.event.name} | All Things Web` },
      { name: "description", content: data.event.tagline },
    ],
    matches
  );
};

export async function loader() {
  const hardcodedSlug = "2024-10-05-hackathon-at-sentry";
  const event = await getEventBySlug(hardcodedSlug);
  if (!event) {
    throw new Response("Not Found", { status: 404 });
  }
  const attendeeCount = await getAttendeeCount(event.id);
  const isAtCapacity = attendeeCount >= event.attendeeLimit;
  const isInPast = isEventInPast(event);
  const isRegistrationDisabled = isAtCapacity || isInPast;
  return {
    event,
    attendeeCount,
    attendeeLimit: event.attendeeLimit,
    isAtCapacity,
    isInPast,
    isRegistrationDisabled,
  };
}

export default function Component() {
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
    <div className="flex-1 min-h-[100dvh]">
      <header className="px-4 lg:px-6 h-14 flex items-center">
        <DefaultRightTopNav />
      </header>
      <main className="flex-1 items-center justify-center">
        {isAtCapacity && !isEventInPast && (
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
                    to={`/${event.slug}/register`}
                    className={clsx(
                      "mr-auto md:mr-0 inline-flex h-10 items-center justify-center rounded-md px-8 text-sm font-medium shadow transition-colors bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      { "pointer-events-none opacity-50": isRegistrationDisabled }
                    )}
                    prefetch="intent"
                    aria-disabled={isRegistrationDisabled}
                  >
                    Register Now
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
        <Section variant="big" background="muted">
          <AllYouNeedToKnow
            event={event}
            attendeeCount={attendeeCount}
            attendeeLimit={attendeeLimit}
            isInPast={isInPast}
          />
        </Section>
        <Section variant="big">
          <Schedule />
        </Section>
        <Section variant="big" background="muted">
          <MoreInformation />
        </Section>
        <Section variant="big">
          <Sponsor />
        </Section>
      </main>
      <footer className="flex flex-col gap-2 sm:flex-row py-6 w-full shrink-0 items-center px-4 md:px-6 border-t">
        <p className="text-xs text-muted-foreground">
          &copy; 2024 All Things Web. All rights reserved.
        </p>
      </footer>
    </div>
  );
}

const sectionVariants = cva("flex items-center justify-center w-full", {
  variants: {
    variant: {
      default: "py-6 md:py-12 lg:py-24",
      big: "py-16 md:py-24 lg:py-32",
    },
    background: {
      default: "",
      muted: "bg-muted",
    },
  },
  defaultVariants: {
    variant: "default",
    background: "default",
  },
});

function Section({
  children,
  className,
  variant,
  background,
  ...props
}: HTMLAttributes<HTMLElement> & VariantProps<typeof sectionVariants>) {
  return (
    <section
      {...props}
      className={cn(sectionVariants({ variant, background, className }))}
    >
      {children}
    </section>
  );
}

function AllYouNeedToKnow({
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
    <div className="w-full px-4 md:px-6 flex flex-col md:items-center justify-center md:flex-row gap-12 lg:gap-24">
      <div className="flex md:items-center gap-4">
        <UsersIcon className="h-12 w-12 text-primary" />
        <div>
          <h4 className="text-xl lg:text-2xl xl:text-3xl font-medium">
            {!isInPast && attendeeCount < attendeeLimit
              ? "Spots available"
              : !isInPast && attendeeCount >= attendeeLimit
              ? "At capacity"
              : "Event has ended"}
          </h4>
          <p className="text-lg lg:text-xl text-muted-foreground text-nowrap">
            {attendeeCount} / {attendeeLimit} hackers registered
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <MapPinIcon className="h-12 w-12 text-primary" />
        <div>
          <h4 className="text-xl lg:text-2xl xl:text-3xl font-medium">
            {event.shortLocation}
          </h4>
          <p className="text-lg lg:text-xl text-muted-foreground text-nowrap">
            {event.streetAddress}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <CalendarHeart className="h-12 w-12 text-primary" />
        <div>
          <h4 className="text-xl lg:text-2xl xl:text-3xl font-medium">
            Saturday
          </h4>
          <p className="text-lg lg:text-xl text-muted-foreground text-nowrap">
            October 05, 2024
          </p>
        </div>
      </div>
    </div>
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
          time="11:30 am"
          title="Doors open"
          description="Get to know your fellow hackers and form teams."
        />
        <ScheduleItem
          time="12:30 pm"
          title="Kick-off presentation"
          description="Get ready for a day of coding, networking, and fun!"
        />
        <ScheduleItem
          time="1 - 7 pm"
          title="Hacking time"
          description="Focus on your project, ask for help, and enjoy the snacks."
        />
        <ScheduleItem
          time="7 pm"
          title="Presentations & awards ceremony"
          description="Show off your project and vote for the best ones!"
        />
        <ScheduleItem
          time="8 pm"
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
    <div className="container px-4 md:px-6">
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-12">
        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
            When and Where
          </h2>
          <p className="max-w-[600px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
            The event will take place on Saturday, October 5, 2024 at the Sentry
            office in San Francisco. Doors will open at 10:30 am. Join us for a
            day of coding, networking, and fun!
          </p>
        </div>
        <div id="prizes" className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
            Awards and Prizes
          </h2>
          <p className="max-w-[600px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
            At the end of the event, we&apos;ll vote for the most creative and
            the most impactful projects. The winning teams will be awarded with
            prizes. Stay tuned for more details!
          </p>
        </div>
        <div id="sponsors" className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
            Theme
          </h2>
          <p className="max-w-[600px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
            The theme of the hackathon is "Open Source." We’d love for you to
            use open-source tools, maybe even give back to the community during
            the event! But feel free to work on whatever sparks your interest.
            And don’t forget—two prizes are up for grabs: most creative and most
            impactful!
          </p>
        </div>
        <div id="sponsors" className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
            Team Building
          </h2>
          <p className="max-w-[600px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
            No need to stress about finding a team before the event! We’ll kick
            things off with some fun ice breakers and team building. You can
            bring friends, team up on the spot, or fly solo if that’s more your
            style. Teaming up isn’t mandatory, but it’s an awesome way to make
            new friends!
          </p>
        </div>
      </div>
    </div>
  );
}

function Sponsor() {
  return (
    <div className="container px-4 md:px-6 mx-auto max-w-4xl">
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
              For software teams, Sentry is essential for monitoring application
              code quality. From Error tracking to Performance monitoring,
              developers can see clearer, solve quicker, and learn continuously
              about their applications — from frontend to backend. Loved by
              nearly 4 million developers and 90,000 organizations worldwide,
              Sentry provides code-level observability to many of the world’s
              best-known companies like Disney, Cloudflare, Eventbrite, Slack,
              Supercell, and Rockstar Games.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
