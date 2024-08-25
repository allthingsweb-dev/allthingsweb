import { serve } from "inngest/remix";
import { inngest } from "~/modules/inngest/inngest.server";
import { eventAttendeeRegisteredFn, syncAttendeesWithLumaFn } from "~/modules/inngest/functions.server";

const handler = serve({
  client: inngest,
  functions: [eventAttendeeRegisteredFn, syncAttendeesWithLumaFn],
});

export { handler as action, handler as loader };