import { createContainer, InjectionMode, asFunction, asValue } from 'awilix';
import { redirect } from 'react-router';
import { mainConfig, type MainConfig } from '../config.server';
import { createLogger, type Logger } from './logger.server';
import { createSessionManager, type SessionManager } from './session/create-session-manager.server';
import { createMailer, type Mailer } from './mailer.server';
import { createServerTimingsProfiler } from './server-timing.server';
import { createLumaClient } from './luma/api.server';
import { createPosthogClient } from './posthog/posthog.server';
import { createDatabaseClient } from './db/client.server';

export const buildContainer = () => {
  // 1. load the config
  const logger = createLogger(mainConfig.instanceId, ['info', 'debug']);

  // 2. Build the container
  const container = createContainer<{
    logger: Logger;
    mainConfig: MainConfig;
    sessionManager: SessionManager;
    mailer: Mailer;
    serverTimingsProfiler: ReturnType<typeof createServerTimingsProfiler>;
    db: ReturnType<typeof createDatabaseClient>;
    lumaClient: ReturnType<typeof createLumaClient>;
    posthogClient: ReturnType<typeof createPosthogClient>;
  }>({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  container.register({
    logger: asValue(logger),
    mainConfig: asValue(mainConfig),
    sessionManager: asFunction(createSessionManager)
      .inject(() => ({ redirect }))
      .singleton(),
    mailer: asFunction(createMailer).singleton(),
    serverTimingsProfiler: asFunction(createServerTimingsProfiler).scoped(),
    db: asFunction(createDatabaseClient).singleton(),
    lumaClient: asFunction(createLumaClient).singleton(),
    posthogClient: asFunction(createPosthogClient).singleton(),
  });

  return container;
};
