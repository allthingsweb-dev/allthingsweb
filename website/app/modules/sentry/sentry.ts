import * as Sentry from "@sentry/remix";
import { useLocation, useMatches } from "@remix-run/react";
import { useEffect } from "react";

const meta = document.querySelector(
  'meta[name="x-sentry"]'
) as HTMLMetaElement | null;
if (meta) {
  Sentry.init({
    dsn: meta.content,
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
    ],
  });
}
