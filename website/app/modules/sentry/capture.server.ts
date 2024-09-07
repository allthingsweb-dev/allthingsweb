import * as Sentry from '@sentry/remix';

export function captureException(e: unknown) {
  Sentry.captureException(e);
}
