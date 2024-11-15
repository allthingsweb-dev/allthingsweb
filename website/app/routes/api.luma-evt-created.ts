import { ActionFunctionArgs } from '@remix-run/node';
import { captureException } from '~/modules/sentry/capture.server';

export async function action({ request, context }: ActionFunctionArgs) {
  const data = await request.json();
  const secretKey = request.headers.get('x-secret-key');
  if (!context.mainConfig.zapier.webhookSecret) {
    console.warn('Rejected webhook request because env.zapierWebhookSecret is not set');
    return new Response('Forbidden', { status: 403, statusText: 'Forbidden' });
  }
  if (secretKey !== context.mainConfig.zapier.webhookSecret) {
    return new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' });
  }
  const eventId = data.eventId;
  if (!eventId) {
    return new Response('Missing eventId', { status: 400, statusText: 'Bad Request' });
  }
  try {
    // NOOP currently not in use
  } catch (e) {
    captureException(e);
    return new Response('Failed to create event', { status: 500, statusText: 'Internal Server Error' });
  }
  return new Response('Ok', { status: 200, statusText: 'Ok' });
}
