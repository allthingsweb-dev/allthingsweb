import {
  Links,
  Meta,
  Outlet,
  redirect,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react";
import tailwindStyles from "./tailwind.css?url";
import { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { PageTransitionProgressBar } from "./modules/components/page-transition";
import { ErrorPage } from "./modules/components/error-page";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: tailwindStyles },
];

export function loader({ request }: LoaderFunctionArgs) {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/" && pathname.endsWith("/")) {
    return redirect(pathname.slice(0, -1));
  }
  return {
    posthogPublicAPIKey: process.env.POSTHOG_PUBLIC_API_KEY,
  };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { posthogPublicAPIKey } = useLoaderData<typeof loader>();
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {posthogPublicAPIKey && (
          <meta name="x-posthog" content={posthogPublicAPIKey} />
        )}
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
