import * as Sentry from '@sentry/remix';
import type { EntryContext } from '@remix-run/server-runtime';
import { RemixServer } from '@remix-run/react';
import { renderToReadableStream } from 'react-dom/server.browser';
import { isbot } from 'isbot';
import { env } from '~/modules/env.server.ts';

if (env.sentry.dsn && !Sentry.isInitialized()) {
  console.log('Initializing Sentry for Remix');
  Sentry.init({
    dsn: env.sentry.dsn,
    tracesSampleRate: 1,
    autoInstrumentRemix: true,
    environment: env.environment,
  });
}

export const handleError = Sentry.wrapHandleErrorWithSentry(
  (error) => {
    // Custom handleError implementation
    console.error(error);
  },
);

const ABORT_DELAY = 5000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ABORT_DELAY);

  const body = await renderToReadableStream(
    <RemixServer
      context={remixContext}
      url={request.url}
      abortDelay={ABORT_DELAY}
    />,
    {
      signal: controller.signal,
      onError(error: unknown) {
        if (!controller.signal.aborted) {
          // Log streaming rendering errors from inside the shell
          console.error(error);
        }
        responseStatusCode = 500;
      },
    },
  );

  body.allReady.then(() => clearTimeout(timeoutId));

  if (isbot(request.headers.get('user-agent') || '')) {
    await body.allReady;
  }

  responseHeaders.set('Content-Type', 'text/html');
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
