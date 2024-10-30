import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from '@remix-run/react';
import { captureRemixErrorBoundaryError, withSentry } from '@sentry/remix';
import tailwindStyles from './tailwind.css?url';
import { LinksFunction, LoaderFunctionArgs, MetaFunction, json } from '@remix-run/node';
import { PageTransitionProgressBar } from './modules/components/page-transition';
import { ErrorPage } from './modules/components/error-page';
import { env } from './modules/env.server';
import { requireCanonicalSession } from './modules/session/session.server';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: tailwindStyles },
  { rel: 'alternate', type: 'application/rss+xml', href: '/rss' },
  { rel: 'icon', href: '/favicon-16.png', sizes: '16x16' },
  { rel: 'icon', href: '/favicon-32.png', sizes: '32x32' },
  { rel: 'icon', href: '/favicon-192.png', sizes: '192x192' },
  { rel: 'icon', href: '/favicon-512.png', sizes: '512x512' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
];

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const meta: ReturnType<MetaFunction> = [];
  if (data?.posthogPublicAPIKey) {
    meta.push({ name: 'x-posthog', content: data.posthogPublicAPIKey });
  }
  if (data?.sentryDsn) {
    meta.push({ name: 'x-sentry', content: data.sentryDsn });
  }
  if (data?.appVersion) {
    meta.push({ name: 'x-app-version', content: data.appVersion });
  }
  if (data?.serverOrigin) {
    meta.push({ name: 'x-server-origin', content: data.serverOrigin });
  }
  return meta;
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const [userSession, headers] = await requireCanonicalSession(request);
  return json(
    {
      csrfToken: userSession.csrfToken,
      posthogPublicAPIKey: env.posthogPublicAPIKey,
      sentryDsn: env.sentry.dsn,
      appVersion: context.appVersion,
      serverOrigin: env.server.origin,
    },
    { headers },
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <PageTransitionProgressBar />
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function App() {
  return <Outlet />;
}

export default withSentry(App);

export function ErrorBoundary() {
  const error = useRouteError();
  captureRemixErrorBoundaryError(error);
  return <ErrorPage />;
}
