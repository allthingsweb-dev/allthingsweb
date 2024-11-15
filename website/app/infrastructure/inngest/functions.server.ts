import { createEventAttachment, createSuccessfulEventSignupHtml } from '../../modules/email/templates';
import { captureException } from '../../modules/sentry/capture.server';
import { InngestEventData, InngestServer } from '~/domain/contracts/inngest';
import { Mailer } from '~/domain/contracts/mailer';
import { MainConfig } from '~/domain/contracts/config';
import { PocketBaseClient } from '~/domain/contracts/pocketbase';
import { LumaClient } from '~/domain/contracts/luma';

type Deps = {
  mainConfig: MainConfig;
  inngestServer: InngestServer;
  pocketBaseClient: PocketBaseClient;
  lumaClient: LumaClient;
  mailer: Mailer;
};
export const buildInngestFunctions = ({
  inngestServer,
  mainConfig,
  mailer: sendEmail,
  pocketBaseClient,
  lumaClient,
}: Deps) => {
  const { getEventBySlug, getUpcomingEvents, getAttendees, registerAttendee } = pocketBaseClient;
  const { addAttendee: addAttendeeOnLuma, getAllAttendees: getLumaAttendees } = lumaClient;
  const eventAttendeeRegisteredFn = inngestServer.inngest.createFunction(
    {
      id: 'event-attendee-registered-fn',
      onFailure: ({ error }) => {
        captureException(error);
      },
    },
    { event: 'event/attendee.registered' },
    async ({ event: inngestEvent, step }) => {
      const { attendee, eventSlug } = inngestEvent.data as InngestEventData['event/attendee.registered'];
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
            serverOrigin: mainConfig.origin,
            attendee: attendee,
          });
          const html = createSuccessfulEventSignupHtml({
            username: attendee.name,
            userId: attendee.id,
            event,
            serverOrigin: mainConfig.origin,
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
  const syncAttendeesWithLumaFn = inngestServer.inngest.createFunction(
    {
      id: 'sync-attendees-with-luma-fn',
      retries: 0, // no need to retry as we run this every hour
      onFailure: ({ error }) => {
        captureException(error);
      },
    },
    { cron: 'TZ=America/Los_Angeles 0 * * * *' }, // every hour
    async (/* { step }*/) => {
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
            await registerAttendee(event.id, lumaAttendee.name, lumaAttendee.email.toLowerCase());
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
          if (lumaAttendees.some((a) => a.email.toLowerCase() === attendee.email)) {
            continue;
          }
          await addAttendeeOnLuma(event.lumaEventId, attendee);
        }
      }
    },
  );

  return [eventAttendeeRegisteredFn, syncAttendeesWithLumaFn];
};
