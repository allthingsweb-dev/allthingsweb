import { z } from "zod";
import { Route } from "./+types/api.events.$id.register";

const schema = z.object({
  email: z.string().email(),
});

export async function action({ request, params, context }: Route.ActionArgs) {
  const { id } = params;
  const parsedPayload = schema.safeParse(await request.json());
  if (!parsedPayload.success) {
    return Response.json(
      { success: false, error: "Invalid email" },
      { status: 400, statusText: "Invalid email" },
    );
  }
  const { email } = parsedPayload.data;
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
  try {
    const [lumaEvent, attendees] = await Promise.all([
      context.lumaClient.getEvent(event.lumaEventId),
      context.lumaClient.getAllAttendees(event.lumaEventId),
    ]);
    if (!lumaEvent) {
      return Response.json(
        { success: false, error: "Event not found on Luma" },
        { status: 404, statusText: "Event not found on Luma" },
      );
    }
    const hosts = lumaEvent.hosts;
    if(hosts.map((host) => host.email).includes(email)) {
      return Response.json(
        { success: false, error: "Already registered as a host" },
        { status: 400, statusText: "Already registered as a host" },
      );
    }
    
    if(attendees.map((attendee) => attendee.email).includes(email)) {
      return Response.json(
        { success: false, error: "Already registered as an attendee" },
        { status: 400, statusText: "Already registered as an attendee" },
      );
    }

    await context.lumaClient.addAttendees(event.lumaEventId, [{
      email,
      name: null,
    }]);
    
    return Response.json({ success: true });
  } catch(error: unknown) {
      const message = error instanceof Error ? error.message : 'Something went wrong';
      return Response.json({ success: false, error: message})
  }
}
