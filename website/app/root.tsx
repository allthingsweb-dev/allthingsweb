import {
  data,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { PageTransitionProgressBar } from "./modules/components/page-transition";
import { ErrorPage } from "./modules/components/error-page";
import type { Route } from "./+types/root";
import "./tailwind.css";

export const links: Route.LinksFunction = () => [
  { rel: "alternate", type: "application/rss+xml", href: "/rss" },
  { rel: "icon", href: "/favicon-16.png", sizes: "16x16" },
  { rel: "icon", href: "/favicon-32.png", sizes: "32x32" },
  { rel: "icon", href: "/favicon-192.png", sizes: "192x192" },
  { rel: "icon", href: "/favicon-512.png", sizes: "512x512" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
];

export const meta: Route.MetaFunction = ({ data }) => {
  const meta: ReturnType<Route.MetaFunction> = [];
  if (data?.posthogPublicAPIKey) {
    meta.push({ name: "x-posthog", content: data.posthogPublicAPIKey });
  }
  if (data?.sentryDsn) {
    meta.push({ name: "x-sentry", content: data.sentryDsn });
  }
  if (data?.appVersion) {
    meta.push({ name: "x-app-version", content: data.appVersion });
  }
  if (data?.serverOrigin) {
    meta.push({ name: "x-server-origin", content: data.serverOrigin });
  }
  return meta;
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const [userSession, headers] =
    await context.session.requireCanonicalSession(request);
  return data(
    {
      csrfToken: userSession.csrfToken,
      posthogPublicAPIKey: context.mainConfig.posthog.publicApiKey,
      sentryDsn: context.mainConfig.sentry.dsn,
      appVersion: context.appVersion,
      serverOrigin: context.mainConfig.origin,
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

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary() {
  return <ErrorPage />;
}
