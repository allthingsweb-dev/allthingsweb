import { serve } from 'inngest/remix';
import { inngest } from '~/modules/inngest/inngest.server.ts';
import { eventAttendeeRegisteredFn } from '~/modules/inngest/functions.server.ts';

const handler = serve({
  client: inngest,
  functions: [eventAttendeeRegisteredFn],
});

export { handler as action, handler as loader };
