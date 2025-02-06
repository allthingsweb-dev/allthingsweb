import { createContainer, InjectionMode, asFunction, asValue } from 'awilix';
import { redirect } from '@remix-run/node';
import { mainConfig, type MainConfig } from '../config.server';
import { createLogger, Logger } from './logger.server';
import { createSessionManager, SessionManager } from './session/create-session-manager.server';
import { createMailer, Mailer } from './mailer.server';
import { createServerTimingsProfiler } from './server-timing.server';
import { createLumaClient } from './luma/api.server';
import { createPosthogClient } from './posthog/posthog.server';
import { createPocketbaseClient } from './pocketbase/api.server';

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
    pocketBaseClient: ReturnType<typeof createPocketbaseClient>;
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
    pocketBaseClient: asFunction(createPocketbaseClient).singleton(),
    lumaClient: asFunction(createLumaClient).singleton(),
    posthogClient: asFunction(createPosthogClient).singleton(),
  });

  return container;
};
