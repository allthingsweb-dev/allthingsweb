import { createRequestHandler } from '@remix-run/express';
import * as Sentry from '@sentry/bun';
import compression from 'compression';
import express, { NextFunction, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import morgan from 'morgan';
import { env } from '~/modules/env.server.js';
import { buildContainer } from '~/core/container.server.js';
import { SessionManager } from '~/domain/contracts/session.js';

const isProduction = process.env.NODE_ENV === 'production';
const productionBuild = isProduction ? await import('../build/server/index.js') : undefined;

const appVersion = productionBuild ? productionBuild.assets.version : 'dev';
console.log(`Running app version ${appVersion}`);
console.log(`Server timezone offset: ${new Date().getTimezoneOffset() / 60} hours`);

if (env.sentry.dsn) {
  console.log('Initializing Sentry for the express server');
  Sentry.init({
    dsn: env.sentry.dsn,
    tracesSampleRate: 1,
    environment: env.environment,
    release: appVersion,
  });
}

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
    services: ReturnType<typeof buildContainer>['cradle'];
    logger: ReturnType<typeof buildContainer>['cradle']['logger'];
    createQuery: ReturnType<typeof buildContainer>['cradle']['queryBus']['createQuery'];
    dispatchQuery: ReturnType<typeof buildContainer>['cradle']['queryBus']['dispatch'];
    createCommand: ReturnType<typeof buildContainer>['cradle']['commandBus']['createCommand'];
    dispatchCommand: ReturnType<typeof buildContainer>['cradle']['commandBus']['dispatch'];
    session: SessionManager;
  }
}
let container = buildContainer();
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
      createQuery: scopedServices.cradle.queryBus.createQuery,
      dispatchQuery: scopedServices.cradle.queryBus.dispatch,
      createCommand: scopedServices.cradle.commandBus.createCommand,
      dispatchCommand: scopedServices.cradle.commandBus.dispatch,
      session: scopedServices.cradle.sessionManager,
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

const port = env.server.port;
app.listen(port, () => container.cradle.logger.start(`Remix server listening at http://localhost:${port}`));
