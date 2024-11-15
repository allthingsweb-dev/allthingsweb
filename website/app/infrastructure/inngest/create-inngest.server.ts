import { Inngest } from 'inngest';
import { MainConfig } from '~/domain/contracts/config';
import { InngestServer } from '~/domain/contracts/inngest';
import { Logger } from '~/domain/contracts/logger';

type Deps = {
  mainConfig: MainConfig;
  logger: Logger;
};

type InngestEventData = {
  'event/attendee.registered': {
    attendee: {
      email: string;
      name: string;
      id: string;
    };
    eventSlug: string;
  };
};

type InngestEventName = keyof InngestEventData;

export const createInngestServer = ({ mainConfig, logger }: Deps): InngestServer => {
  const inngest = new Inngest({
    id: 'allthingsweb-app',
  });

  const publishEvent = <T extends InngestEventName>(eventName: T, data: InngestEventData[T]) => {
    if (!mainConfig.inngest.signingKey || !mainConfig.inngest.eventKey) {
      logger.warn('Did not send inngest event because signingKey or eventKey is not set', {
        eventName,
        data,
      });
      return;
    }
    return inngest.send({
      name: eventName,
      data,
    });
  };

  return {
    inngest,
    publishEvent,
  };
};
