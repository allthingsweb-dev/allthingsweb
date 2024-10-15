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

// @ts-ignore comment
const handleRequest = createRequestHandler(productionBuild, 'production');

function serveStaticFile(filePath: string, cacheHeaderValue: string): Response {
  try {
    const file = Deno.openSync(filePath, { read: true });
    return new Response(file.readable, {
      headers: {
        'Cache-Control': cacheHeaderValue,
      },
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return new Response(null, { status: 404, statusText: 'Not Found' });
    }
    throw error;
  }
}

Deno.serve({
  port: env.server.port,
  handler: (req) => {
    const url = new URL(req.url);
    console.log(`[${req.method}] ${url.pathname}`);

    // Test error handling & Sentry integration
    if (url.pathname === '/tests/errors/server-error') {
      throw new Error('This is a test error from Express on Bun.');
    }

    // Serve Remix client code, cache for a year (max max-age)
    if (url.pathname.startsWith('/assets/')) {
      const filePath = path.join('./build/client', url.pathname);
      return serveStaticFile(filePath, 'public, max-age=31536000, immutable');
    }

    // Serve static files from /public folder, cache for an hour
    try {
      const filePath = path.join('./build/client', url.pathname);
      const fileInfo = Deno.statSync(filePath);

      if (fileInfo.isDirectory) {
        throw new Deno.errors.NotFound();
      }
      
      console.log(`attempting to serve ${filePath}`)
      const file = Deno.openSync(filePath, { read: true });
      return new Response(file.readable, {
        headers: {
          'Cache-Control': `public, max-age=${60 * 60}`,
        },
      });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }

    // Serve with Remix
    console.log('handling req with remix...');
    return handleRequest(req, { appVersion });
  },
  onError: (error) => {
    Sentry.captureException(error);
    console.error(error);
    return new Response(null, { status: 500, statusText: 'Internal Server Error' });
  },
});
