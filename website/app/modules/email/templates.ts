import { Event } from "../pocketbase/pocketbase";

export function getSuccessfulEventSignupHtml(username: string, userId: string, event: Event, serverOrigin: string) {
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
      src="${serverOrigin}/hero-image-hackathon.png"
      alt="${event.name} illustration"
    />
    <p>Hey ${username},</p>
    <p>
      Thank you for signing up for ${event.name}! We are excited to see you at
      Sentry in San Francisco on ${event.start.toLocaleDateString("en-US", {
      weekday: 'long', month: 'long', day: 'numeric' })}.
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
      <a href="${serverOrigin}/${event.slug}/cancel?attendee=${userId}">
        Cancel registration
      </a>
    </p>
    <p>Your All Things Web team</p>
  </body>
</html>
`;
}
