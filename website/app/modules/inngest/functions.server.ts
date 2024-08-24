import { InngestEventData, inngest } from "./inngest.server";
import { env } from "../env.server";
import {
  createEventAttachment,
  createSuccessfulEventSignupHtml,
} from "../email/templates";
import { getEventBySlug } from "../pocketbase/api.server";
import { sendEmail } from "../email/resend.server";
import { addAttendee } from "../luma/api.server";

export const eventAttendeeRegisteredFn = inngest.createFunction(
  { id: "event-attendee-registered-fn" },
  { event: "event/attendee.registered" },
  async ({ event: inngestEvent, step }) => {
    const { attendee, eventSlug } =
      inngestEvent.data as InngestEventData["event/attendee.registered"];
    const event = await getEventBySlug(eventSlug);
    if (!event) {
      throw new Error(`Event not found for slug: ${eventSlug}`);
    }
    await Promise.all([
      step.run("send-registration-email", async () => {
        if (event.lumaEventId) {
          // event is managed by Luma, so we don't need to send an email
          return;
        }
        const attachment = await createEventAttachment({
          event,
          serverOrigin: env.server.origin,
          attendee: attendee,
        });
        const html = createSuccessfulEventSignupHtml({
          username: attendee.name,
          userId: attendee.id,
          event,
          serverOrigin: env.server.origin,
        });
        sendEmail({
          from: {
            name: "Team",
            email: "events@allthingsweb.dev",
          },
          to: [attendee.email],
          subject: `${event.name} - You're in!`,
          html,
          attachments: [attachment],
        });
      }),
      step.run("post-attendee-on-luma", async () => {
        if (!event.lumaEventId) {
          return;
        }
        // Adding the attendee to the Luma event; this will also trigger the Luma registration email
        await addAttendee(event.lumaEventId, attendee);
      }),
    ]);
  }
);
