import { createRequestHandler } from '@remix-run/express';
import * as Sentry from '@sentry/bun';
import compression from 'compression';
import express, { NextFunction, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import morgan from 'morgan';
import { env } from '~/modules/env.server.js';

const productionBuild = env.environment === 'production' ? await import('../build/server/index.js') : undefined;

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

const viteDevServer =
  env.environment === 'production'
    ? undefined
    : await import('vite').then((vite) =>
        vite.createServer({
          server: { middlewareMode: true },
        }),
      );

declare module '@remix-run/node' {
  interface AppLoadContext {
    appVersion: string;
  }
}

const remixHandler = createRequestHandler({
  // @ts-ignore comment
  build: viteDevServer ? () => viteDevServer.ssrLoadModule('virtual:remix/server-build') : productionBuild,
  getLoadContext: () => ({
    appVersion,
  }),
});

const app = express();

app.use(compression());

// http://expressjs.com/en/advanced/best-practice-security.html#at-a-minimum-disable-x-powered-by-header
app.disable('x-powered-by');

// handle asset requests
if (viteDevServer) {
  app.use(viteDevServer.middlewares);
} else {
  // Vite fingerprints its assets so we can cache forever.
  app.use('/assets', express.static('build/client/assets', { immutable: true, maxAge: '1y' }));
}

// Everything else (like favicon.ico) is cached for an hour. You may want to be
// more aggressive with this caching.
app.use(express.static('build/client', { maxAge: '1h' }));

app.use(morgan('tiny'));

app.use('/tests/errors/server-error', (req, res) => {
  throw new Error('This is a test error from Express on Bun.');
});

// handle SSR requests
app.all('*', remixHandler);

// Add this after all routes,
// but before any and other error-handling middlewares are defined
Sentry.setupExpressErrorHandler(app);

// Log errors to console
app.use((err: Error, req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
  console.error(err);
  next(err);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Express server listening at http://localhost:${port}`));
