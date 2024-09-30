import { toReadableDateTimeStr } from '../datetime';
import { Event } from '../pocketbase/pocketbase';

export async function createEventAttachment({
  event,
  serverOrigin,
  attendee,
}: {
  event: Event;
  serverOrigin: string;
  attendee: {
    email: string;
    name: string;
  };
}) {
  const description = `${event.tagline}\n\nEvent page: ${serverOrigin}/${event.slug}`;
  const ics = `
BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
PRODID:-//All Things Web//EN
BEGIN:VEVENT
UID:${event.id}
ORGANIZER;CN=Andre Landgraf:mailto:andre.timo.landgraf@gmail.com
ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE;CN=${attendee.name}:mailto:${attendee.email}
DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '')}Z
DTSTART:${event.start.toISOString().replace(/[-:]/g, '').slice(0, -5)}Z
DTEND:${event.end.toISOString().replace(/[-:]/g, '').slice(0, -5)}Z
SUMMARY:${event.name}
DESCRIPTION:${description}
LOCATION:${event.fullAddress}
URL:${serverOrigin}/${event.slug}
END:VEVENT
END:VCALENDAR
`.trim();
  return {
    content: Buffer.from(ics),
    filename: 'event.ics',
    contentType: 'text/calendar',
  };
}

export function createSuccessfulEventSignupHtml({
  username,
  event,
  serverOrigin,
  userId,
}: {
  username: string;
  userId: string;
  event: Event;
  serverOrigin: string;
}) {
  const imgSrc = event.isHackathon
    ? `${serverOrigin}/hero-image-hackathon.png`
    : `${serverOrigin}/hero-image-meetup.png`;
  return `
<html lang="en">
  <head>
    <title>${event.name} signup</title>
    <style>
      body {
        width: 100%;
        max-width: 700px;
        font-family: Arial, sans-serif;
        background-color: #ffffff;
      }
      h1 {
        color: #333;
        font-size: 24px;
        font-weight: 700;
        margin-bottom: 16px;
      }
      h2 {
        color: #333;
        font-size: 20px;
        font-weight: 700;
        margin-bottom: 8px;
      }
      p {
        color: #666;
        font-size: 16px;
        margin-bottom: 8px;
      }
      a {
        color: #0070f3;
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      img {
        width: 100%;
        max-width: 500px;
        margin-bottom: 16px;
      }
    </style>
  </head>
  <body>
    <h1>You are signed up for ${event.name}!</h1>
    <img
      src="${imgSrc}"
      alt="${event.name} illustration"
    />
    <p>Hey ${username},</p>
    <p>
      Thank you for signing up for ${event.name}! We are excited to see you at
      Sentry in San Francisco on ${toReadableDateTimeStr(event.start)}.
    </p>
    <p>
      You can find more information about the event on the
      <a href="${serverOrigin}/${event.slug}">event page</a>.
    </p>
    <p>See you there!</p>
    <h2>Can't make it?</h2>
    <p>
      There are only limited spots available, so if you can't make it, please
      let us know by canceling your registration. You can do so by clicking the
      link below:
      <br />
      <a href="${serverOrigin}/${event.slug}/cancel?attendee=${userId}">
        Cancel registration
      </a>
    </p>
    <p>Your All Things Web team</p>
  </body>
</html>
`;
}
