import * as Sentry from "@sentry/react";
import { clientEnv } from "../env.client";

if (clientEnv.sentryDsn) {
  Sentry.init({
    dsn: clientEnv.sentryDsn,
    tracesSampleRate: 1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1,

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
      Sentry.feedbackIntegration({
        colorScheme: "system",
      }),
    ],
  });
}
