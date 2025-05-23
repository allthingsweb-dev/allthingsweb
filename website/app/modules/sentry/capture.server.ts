import * as Sentry from "@sentry/node";

export function captureException(e: unknown, ctx?: Record<string, unknown>) {
  Sentry.captureException(e, {
    extra: ctx,
  });
}
