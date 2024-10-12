import { createRequestHandler } from '@remix-run/server-runtime';
import * as Sentry from '@sentry/deno';
import path from 'node:path';
import { env } from '~/modules/env.server.ts';

const productionBuild = await import('../build/server/index.js');
const appVersion = productionBuild.assets.version;
console.log(`Running app version ${appVersion}`);
console.log(
  `Server timezone offset: ${new Date().getTimezoneOffset() / 60} hours`,
);

if (env.sentry.dsn) {
  console.log('Initializing Sentry for the express server');
  Sentry.init({
    dsn: env.sentry.dsn,
    tracesSampleRate: 1,
    environment: env.environment,
    release: appVersion,
  });
}

declare module '@remix-run/server-runtime' {
  interface AppLoadContext {
    appVersion: string;
  }
}

const remixHandler = createRequestHandler({
  // @ts-ignore comment
  build: productionBuild,
  getLoadContext: () => ({
    appVersion,
  }),
});

async function serveStaticFile(filePath: string, cacheHeaderValue: string): Promise<Response> {
  try {
    const file = await Deno.openSync(filePath, { read: true });
    return new Response(file.readable, {
      headers: {
        'Cache-Control': cacheHeaderValue,
      },
    });
  } catch (error) {
    if (error === Deno.errors.NotFound) {
      return new Response(null, { status: 404, statusText: 'Not Found' });
    }
    console.error(error);
    Sentry.captureException(error);
    return new Response(null, { status: 500, statusText: 'Internal Server Error' });
  }
}

Deno.serve({
  port: env.server.port,
  handler: (req) => {
    const url = new URL(req.url);

    // Test error handling & Sentry integration
    if (url.pathname === '/tests/errors/server-error') {
      throw new Error('This is a test error from Express on Bun.');
    }

    // Serve Remix client code, cache for a year (max max-age)
    if (url.pathname.startsWith('build/client/assets')) {
      return serveStaticFile(url.pathname, 'public, max-age=31536000, immutable');
    }

    // Serve static file from /public folder, cache for an hour
    const dir = path.dirname(url.pathname);
    if (dir === 'build/client') {
      return serveStaticFile(url.pathname, `public, max-age=${60 * 60}`);
    }

    // Serve with Remix
    return remixHandler(req);
  },
  onError: (error) => {
    Sentry.captureException(error);
    console.error(error);
    return new Response(null, { status: 500, statusText: 'Internal Server Error' });
  },
});
