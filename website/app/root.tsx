import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from '@remix-run/react';
import { captureRemixErrorBoundaryError, withSentry } from '@sentry/remix';
import tailwindStyles from './tailwind.css?url';
import { json, LinksFunction, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { PageTransitionProgressBar } from '~/modules/components/page-transition.tsx';
import { ErrorPage } from '~/modules/components/error-page.tsx';
import { env } from '~/modules/env.server.ts';
import { requireCanonicalSession } from '~/modules/session/session.server.ts';

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: tailwindStyles },
  { rel: 'alternate', type: 'application/rss+xml', href: '/rss' },
  {
    rel: 'icon',
    type: 'image/svg+xml',
    // Shout-out to Jacob Paris (@jacobmparis) for this cool trick!
    href:
      'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🚀</text></svg>',
  },
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
    <html lang='en'>
      <head>
        <meta charSet='utf-8' />
        <meta name='viewport' content='width=device-width, initial-scale=1' />
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
