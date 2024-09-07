import { env } from '../env.server';
import { InngestEventData, inngest, InngestEventName } from './inngest.server';

export async function publishEvent<T extends InngestEventName>(eventName: T, data: InngestEventData[T]) {
  if (!env.isInngestEnabled) {
    return;
  }
  return inngest.send({
    name: eventName,
    data,
  });
}
