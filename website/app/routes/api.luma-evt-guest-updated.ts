import { ActionFunctionArgs } from "@remix-run/node";
import { env } from "~/modules/env.server";
import {
  getAttendeeByEmail,
  getEventByLumaEventId,
  registerAttendee,
  updateAttendeeCancellation,
} from "~/modules/pocketbase/api.server";
import { trackEvent } from "~/modules/posthog/posthog.server";
import { captureException } from "~/modules/sentry/capture.server";

type Payload = {
  name: string;
  email: string;
  status: "approved" | "declined" | "pending_approval" | "rejected";
  eventId: string;
};

function isPayload(data: any): data is Payload {
  return (
    typeof data === "object" &&
    "name" in data &&
    "email" in data &&
    "status" in data &&
    "eventId" in data
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const data = await request.json();
  const secretKey = request.headers.get("x-secret-key");
  if (secretKey !== env.zapierWebhookSecret) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!isPayload(data)) {
    console.error("Missing data in Zapier payload", data);
    captureException(
      new Error(`Missing data in Zapier payload: ${JSON.stringify(data)}`)
    );
    return new Response("Missing data in payload", { status: 400 });
  }
  try {
    const { eventId: lumaEventId, name, email, status } = data;
    console.log(
      `Received guest updated event for ${email} with status ${status} for event ${lumaEventId}`
    );
    if (status === "pending_approval") {
      return new Response("Ignoring pending approval", { status: 200 });
    }
    if (status === "rejected") {
      return new Response("Ignoring rejected attendees", { status: 200 });
    }
    const event = await getEventByLumaEventId(lumaEventId);
    if (!event) {
      console.log(`Ignoring unmapped Luma event ${lumaEventId}`);
      return new Response("Ignoring unmapped event", { status: 200 });
    }
    const attendee = await getAttendeeByEmail(event.id, email);
    if (!attendee) {
      console.log(`Registering new attendee ${email} for event ${event.slug}`);
      await registerAttendee(event.id, name, email);
      await trackEvent("attendee registered", event.slug, {
        attendee_id: email,
        event_name: event.name,
        event_id: event.id,
        type: "Luma",
      });
    } else {
      const previouslyCancelled = attendee.canceled;
      const hasCancelled = status === "declined";
      console.log(`Updating attendee ${email} for event ${event.slug}. Has canceled: ${hasCancelled}.`);
      await updateAttendeeCancellation(attendee.id, hasCancelled);
      
      if(!previouslyCancelled && hasCancelled) {
        await trackEvent("attendee canceled", event.slug, {
          attendee_id: email,
          event_name: event.name,
          event_id: event.id,
          type: "Luma",
        });
      } else if(previouslyCancelled && !hasCancelled) {
        await trackEvent("attendee uncanceled", event.slug, {
          attendee_id: email,
          event_name: event.name,
          event_id: event.id,
          type: "Luma",
        });
      } else {
        await trackEvent("attendee re-registered", event.slug, {
          attendee_id: email,
          event_name: event.name,
          event_id: event.id,
          type: "Luma",
        });
      }
    }
  } catch (e) {
    captureException(e);
    return new Response("Failed to create event", { status: 500 });
  }
  return new Response("Ok", { status: 200 });
}
