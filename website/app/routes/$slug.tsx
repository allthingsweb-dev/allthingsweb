import {
  EventDetailsPage,
  SponsorsSection,
  TalksSection,
} from "~/modules/event-details/components";
import { meta } from "~/modules/event-details/meta";
import { loader } from "~/modules/event-details/loader.sever";
import { useLoaderData } from "@remix-run/react";

export { meta, loader };

export default function Component() {
  const { event } = useLoaderData<typeof loader>();
  return (
    <EventDetailsPage>
      {event.talks.length > 0 && <TalksSection talks={event.talks} />}
      {event.sponsors.length > 0 && (
        <SponsorsSection sponsors={event.sponsors} />
      )}
    </EventDetailsPage>
  );
}
