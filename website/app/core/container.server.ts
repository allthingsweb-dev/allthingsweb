import { createContainer, InjectionMode, asFunction, asValue } from 'awilix';
import type { Logger } from '~/domain/contracts/logger';
import { createLogger } from '~/infrastructure/create-logger.server';
import { createCommandBus, createQueryBus } from 'missive.js';
import { CommandBus, CommandDefitions, QueryBus, QueryDefitions } from '~/domain/contracts/bus';
import { MainConfig, MainConfigSchema } from '~/domain/contracts/config';
import { validateConfigOrExit } from './configs.server';
import crypto from 'node:crypto';
import { createSessionManager } from '~/infrastructure/session/create-session-manager.server';
import { redirect } from '@remix-run/node';
import { SessionManager } from '~/domain/contracts/session';

export const buildContainer = () => {
  const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;

  // 1. load the config
  const config: MainConfig = validateConfigOrExit(MainConfigSchema, {
    instanceId: process.env.INSTANCE_ID || crypto.randomUUID(),
    logLevel: ['info', 'debug'],
    port,
    environment: process.env.NODE_ENV || 'development',
    origin: process.env.ORIGIN || `http://localhost:${port}`,
    pocketbase: {
      origin: process.env.POCKETBASE_ORIGIN || '',
      publicOrigin: process.env.PUBLIC_POCKETBASE_ORIGIN || '',
      adminEmail: process.env.POCKETBASE_EMAIL || '',
      adminPassword: process.env.POCKETBASE_PASSWORD || '',
    },
    inngest: {
      signingKey: process.env.INNGEST_SIGNING_KEY || 'xxx',
      eventKey: process.env.INNGEST_EVENT_KEY || 'xxx',
    },
    sessionSecret: process.env.SESSION_SECRET || '',
    resend: {
      apiKey: process.env.RESEND_API_KEY || 'xxx',
    },
    luma: {
      apiKey: process.env.LUMA_API_KEY || 'xxx',
    },
    zapier: {
      webhookSecret: process.env.ZAPIER_WEBHOOK_SECRET || 'xxx',
    },
    posthog: {
      publicApiKey: process.env.POSTHOG_PUBLIC_API_KEY || 'xxx',
    },
    sentry: {
      dsn: process.env.SENTRY_DSN || 'xxx',
      org: process.env.SENTRY_ORG || 'xxx',
      project: process.env.SENTRY_PROJECT || 'xxx',
      authToken: process.env.SENTRY_AUTH_TOKEN || 'xxx',
    },
  });
  const logger = createLogger(config.instanceId, ['info', 'debug']);

  // 2. Build the container
  const container = createContainer<{
    logger: Logger;
    queryBus: QueryBus;
    commandBus: CommandBus;
    mainConfig: MainConfig;
    sessionManager: SessionManager;
  }>({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  container.register({
    logger: asValue(logger),
    mainConfig: asValue(config),
    queryBus: asFunction(() => createQueryBus<QueryDefitions>()).singleton(),
    commandBus: asFunction(() => createCommandBus<CommandDefitions>()).singleton(),
    sessionManager: asFunction(createSessionManager)
      .inject(() => ({ redirect }))
      .singleton(),
  });

  // 3. Setup the Bus
  const simpleLogger = { log: container.cradle.logger.info, error: container.cradle.logger.error };

  // Query Bus
  container.cradle.queryBus.useLoggerMiddleware({ logger: simpleLogger });

  // Command Bus
  container.cradle.commandBus.useLoggerMiddleware({ logger: simpleLogger });

  return container;
};
