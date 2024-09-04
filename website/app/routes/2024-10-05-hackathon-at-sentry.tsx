import { SentryLogoIcon } from "~/modules/components/ui/icons";
import { EventDetailsPage } from "~/modules/event-details/components";
import { Section } from "~/modules/components/ui/section";
import { meta } from "~/modules/event-details/meta";
import { eventDetailsLoader } from "~/modules/event-details/loader.sever";

export { meta };

export function loader() {
  return eventDetailsLoader("2024-10-05-hackathon-at-sentry");
}

export default function Component() {
  return (
    <EventDetailsPage>
      <Section variant="big">
        <Schedule />
      </Section>
      <Section variant="big" background="muted">
        <MoreInformation />
      </Section>
      <Section variant="big">
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
            office in San Francisco. Doors will open at 11:30 am. Join us for a
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
              Sentry is the debuggability platform built for how modern
              developers work. Over 4 million developers worldwide trust
              Sentry’s opinionated approach to debugging—favoring action over
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
