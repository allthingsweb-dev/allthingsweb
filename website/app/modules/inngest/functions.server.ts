import { inngest, InngestEventData } from './inngest.server.ts';
import { env } from '../env.server.ts';
import { createEventAttachment, createSuccessfulEventSignupHtml } from '../email/templates.ts';
import { getAttendees, getEventBySlug, getUpcomingEvents, registerAttendee } from '../pocketbase/api.server.ts';
import { sendEmail } from '../email/resend.server.ts';
import { addAttendee as addAttendeeOnLuma, getAllAttendees as getLumaAttendees } from '../luma/api.server.ts';
import { captureException } from '../sentry/capture.server.ts';

export const eventAttendeeRegisteredFn = inngest.createFunction(
  {
    id: 'event-attendee-registered-fn',
    onFailure: ({ error }) => {
      captureException(error);
    },
  },
  { event: 'event/attendee.registered' },
  async ({ event: inngestEvent, step }) => {
    const { attendee, eventSlug } = inngestEvent
      .data as InngestEventData['event/attendee.registered'];
    const event = await getEventBySlug(eventSlug);
    if (!event) {
      throw new Error(`Event not found for slug: ${eventSlug}`);
    }
    await Promise.all([
      step.run('send-registration-email', async () => {
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
            name: 'Team',
            email: 'events@allthingsweb.dev',
          },
          to: [attendee.email],
          subject: `${event.name} - You're in!`,
          html,
          attachments: [attachment],
        });
      }),
      step.run('post-attendee-on-luma', async () => {
        if (!event.lumaEventId) {
          return;
        }
        // Adding the attendee to the Luma event; this will also trigger the Luma registration email
        await addAttendeeOnLuma(event.lumaEventId, attendee);
      }),
    ]);
  },
);

/**
 * Sync attendees with Luma
 */
export const syncAttendeesWithLumaFn = inngest.createFunction(
  {
    id: 'sync-attendees-with-luma-fn',
    retries: 0, // no need to retry as we run this every hour
    onFailure: ({ error }) => {
      captureException(error);
    },
  },
  { cron: 'TZ=America/Los_Angeles 0 * * * *' }, // every hour
  async () => {
    const events = await getUpcomingEvents();
    for (const event of events) {
      if (!event.lumaEventId) {
        continue;
      }
      const attendees = await getAttendees(event.id);
      const lumaAttendees = await getLumaAttendees(event.lumaEventId);

      // Check what approved attendees on Luma are missing in the database
      for (const lumaAttendee of lumaAttendees) {
        if (lumaAttendee.approval_status !== 'approved') {
          continue;
        }
        const attendee = attendees.find((a) => a.email === lumaAttendee.email.toLowerCase());
        if (!attendee) {
          await registerAttendee(
            event.id,
            lumaAttendee.name,
            lumaAttendee.email.toLowerCase(),
          );
        }
      }

      if (!event.enableRegistrations) {
        // Do not consider registrations from allthingsweb.dev
        continue;
      }

      // Check what approved attendees in the database are missing on Luma
      for (const attendee of attendees) {
        if (attendee.canceled) {
          continue;
        }
        if (
          lumaAttendees.some((a) => a.email.toLowerCase() === attendee.email)
        ) {
          continue;
        }
        await addAttendeeOnLuma(event.lumaEventId, attendee);
      }
    }
  },
);
