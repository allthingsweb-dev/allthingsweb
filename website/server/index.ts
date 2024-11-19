import { createRequestHandler } from '@remix-run/express';
import * as Sentry from '@sentry/bun';
import compression from 'compression';
import express, { NextFunction, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import morgan from 'morgan';
import { MainConfig } from '~/config.server.js';
import { buildContainer } from '~/modules/container.server.js';
import { Logger } from '~/modules/logger.server.js';
import { createPocketbaseClient } from '~/modules/pocketbase/api.server.js';
import { ServerTimingsProfiler } from '~/modules/server-timing.server.js';
import { SessionManager } from '~/modules/session/create-session-manager.server.js';

const isProduction = process.env.NODE_ENV === 'production';
const productionBuild = isProduction ? await import('../build/server/index.js') : undefined;

const appVersion = productionBuild ? productionBuild.assets.version : 'dev';
const viteDevServer = isProduction
  ? undefined
  : await import('vite').then((vite) =>
      vite.createServer({
        server: { middlewareMode: true },
      }),
    );

declare module '@remix-run/node' {
  interface AppLoadContext {
    appVersion: string;
    logger: Logger;
    session: SessionManager;
    mainConfig: MainConfig;
    services: ReturnType<typeof buildContainer>['cradle'];
    serverTimingsProfiler: ServerTimingsProfiler;
    pocketBaseClient: ReturnType<typeof createPocketbaseClient>;
  }
}
let container = buildContainer();
const logger = container.cradle.logger;
logger.info(`Running app version ${appVersion}`);
logger.start(`Server timezone offset: ${new Date().getTimezoneOffset() / 60} hours`);

if (container.cradle.mainConfig.sentry.dsn) {
  logger.log('Initializing Sentry for the express server');
  Sentry.init({
    dsn: container.cradle.mainConfig.sentry.dsn,
    tracesSampleRate: 1,
    environment: container.cradle.mainConfig.environment,
    release: appVersion,
  });
}

const remixHandler = createRequestHandler({
  // @ts-ignore comment
  build: viteDevServer ? () => viteDevServer.ssrLoadModule('virtual:remix/server-build') : productionBuild,
  getLoadContext: () => {
    const scopedServices = container.createScope();
    // here you can register the services that would be request-specific
    return {
      appVersion,
      services: scopedServices.cradle,
      logger: scopedServices.cradle.logger,
      session: scopedServices.cradle.sessionManager,
      mainConfig: scopedServices.cradle.mainConfig,
      serverTimingsProfiler: scopedServices.cradle.serverTimingsProfiler,
      pocketBaseClient: scopedServices.cradle.pocketBaseClient,
    };
  },
});

const app = express();

app.use(compression());

// http://expressjs.com/en/advanced/best-practice-security.html#at-a-minimum-disable-x-powered-by-header
app.disable('x-powered-by');

// handle asset requests
if (viteDevServer) {
  app.use(viteDevServer.middlewares);
  viteDevServer.watcher.on('change', async () => {
    await container.dispose();
    container = buildContainer();
  });
} else {
  // Vite fingerprints its assets so we can cache forever.
  app.use('/assets', express.static('build/client/assets', { immutable: true, maxAge: '1y' }));
}

// Everything else (like favicon.ico) is cached for an hour. You may want to be
// more aggressive with this caching.
app.use(express.static('build/client', { maxAge: '1h' }));

app.use(
  morgan('tiny', {
    stream: {
      write: (message) => {
        container.cradle.logger.info(message.trim());
      },
    },
  }),
);

app.use('/tests/errors/server-error', () => {
  throw new Error('This is a test error from Express on Bun.');
});

// handle SSR requests
app.all('*', remixHandler);

// Add this after all routes,
// but before any and other error-handling middlewares are defined
Sentry.setupExpressErrorHandler(app);

// Log errors to console
app.use((err: Error, _req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
  console.error(err);
  next(err);
});

const port = container.cradle.mainConfig.port;
app.listen(port, () =>
  logger.success(
    `Remix server listening at ${container.cradle.mainConfig.origin} in ${container.cradle.mainConfig.environment} mode`,
  ),
);
