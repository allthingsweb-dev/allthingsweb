import { EventDetailsPage } from "~/modules/event-details/components";
import { meta } from "~/modules/event-details/meta";
import { loader } from "~/modules/event-details/loader.sever";

export { loader, meta };

export default function Component() {
  return <EventDetailsPage />;
}
