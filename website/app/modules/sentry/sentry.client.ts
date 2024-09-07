import * as Sentry from '@sentry/remix';
import { useLocation, useMatches } from '@remix-run/react';
import { useEffect } from 'react';
import { clientEnv } from '../env.client';

if (clientEnv.sentryDsn) {
  Sentry.init({
    dsn: clientEnv.sentryDsn,
    tracesSampleRate: 1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1,

    integrations: [
      Sentry.browserTracingIntegration({
        useEffect,
        useLocation,
        useMatches,
      }),
      Sentry.replayIntegration(),
      Sentry.feedbackIntegration({
        colorScheme: 'system',
      }),
    ],
  });
}
