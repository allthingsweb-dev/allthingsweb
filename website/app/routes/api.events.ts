import { Route } from "./+types/api.events";

export async function loader({ context }: Route.ActionArgs) {
  const events = await context.queryClient.getPublishedUpcomingEvents();
  const data = events.map((event) => ({
    id: event.id,
    slug: event.slug,
    name: event.name,
    startDate: event.startDate,
    location: event.shortLocation,
  }));
  return Response.json({ success: true, data });
}
