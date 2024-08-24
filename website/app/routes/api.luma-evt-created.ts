import { ActionFunctionArgs } from "@remix-run/node";
import { env } from "~/modules/env.server";
import { captureException } from "~/modules/sentry/capture.server";

export async function action({ request }: ActionFunctionArgs) {
  const data = await request.json();
  const secretKey = request.headers.get("x-secret-key");
  if(secretKey !== env.zapierWebhookSecret) {
    return new Response("Unauthorized", { status: 401 });
  }
  const eventId = data.eventId;
  if(!eventId) {
    return new Response("Missing eventId", { status: 400 });
  }
  try {
    // NOOP currently not in use
  } catch(e) {
    captureException(e);
    return new Response("Failed to create event", { status: 500 });
  }
  return new Response("Ok", { status: 200 });
}
