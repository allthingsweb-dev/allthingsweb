import { useQuery, useZero } from "@rocicorp/zero/react";
import { schema } from "@lib/zero-sync/schema";

export default function Home() {
  const z = useZero<typeof schema>();

  // Query all events, ordered by start date
  const eventQuery = z.query.events.limit(10);

  const [events, eventsDetail] = useQuery(eventQuery);
  console.log(events, eventsDetail);

  return (
    <div>
      <h1>Upcoming Events</h1>
      <div>
        {events.map((event) => (
          <div key={event.id}>
            <h2>{event.name}</h2>
            <p>Starts: {new Date(event.startDate).toLocaleDateString()}</p>
            <p>Slug: {event.slug}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
