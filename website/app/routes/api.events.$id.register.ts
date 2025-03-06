import { Route } from "./+types/api.events.$id.register";

export async function action({ params, context }: Route.ActionArgs) {
  const { id } = params;
  const event = await context.queryClient.getEventById(id);
  if (!event) {
    return Response.json(
      { success: false, error: "Event not found" },
      { status: 404, statusText: "Event not found" },
    );
  }
  if (!event.lumaEventId) {
    return Response.json(
      { success: false, error: "Event not yet open" },
      { status: 401, statusText: "Event not yet open" },
    );
  }
  // try {
  //     const attendees = await context.lumaClient.getAllAttendees(event.lumaEventId);
  // } catch(error: unknown) {
  //     const message = error instaceof Error ? error.message : 'Something went wrong';
  //     return new Response.json({ success: false, error: message})
  // }
  return Response.json({ success: true });
}
