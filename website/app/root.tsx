import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "@remix-run/react";
import { captureRemixErrorBoundaryError, withSentry } from "@sentry/remix";
import tailwindStyles from "./tailwind.css?url";
import {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { PageTransitionProgressBar } from "./modules/components/page-transition";
import { ErrorPage } from "./modules/components/error-page";
import { env } from "./modules/env.server";
import { requireUserSession } from "./modules/session/session.server";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: tailwindStyles },
];

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const meta: ReturnType<MetaFunction> = [];
  if (data?.posthogPublicAPIKey) {
    meta.push({ name: "x-posthog", content: data.posthogPublicAPIKey });
  }
  if (data?.sentryDsn) {
    meta.push({ name: "x-sentry", content: data.sentryDsn });
  }
  if (data?.appVersion) {
    meta.push({ name: "x-app-version", content: data.appVersion });
  }
  if(data?.serverOrigin) {
    meta.push({ name: "x-server-origin", content: data.serverOrigin });
  }
  return meta;
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireUserSession(request);
  return {
    posthogPublicAPIKey: env.posthogPublicAPIKey,
    sentryDsn: env.sentryDsn,
    appVersion: context.appVersion,
    serverOrigin: env.server.origin,
  };
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
