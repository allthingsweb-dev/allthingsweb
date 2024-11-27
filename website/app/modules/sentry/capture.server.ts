import * as Sentry from '@sentry/remix';

export function captureException(e: unknown, ctx?: Record<string, unknown>) {
  Sentry.captureException(e, {
    extra: ctx,
  });
}
