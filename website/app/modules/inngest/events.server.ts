import { env } from '../env.server.ts';
import { inngest, InngestEventData, InngestEventName } from './inngest.server.ts';

export function publishEvent<T extends InngestEventName>(
  eventName: T,
  data: InngestEventData[T],
) {
  if (!env.inngest.signingKey || !env.inngest.eventKey) {
    console.warn(
      'Did not send inngest event because env.inngest.signingKey or env.inngest.eventKey is not set',
      {
        eventName,
        data,
      },
    );
    return;
  }
  return inngest.send({
    name: eventName,
    data,
  });
}
