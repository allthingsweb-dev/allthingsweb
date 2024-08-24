import { isRouteErrorResponse, NavLink, useRouteError } from "@remix-run/react";
import { ArrowLeft } from "lucide-react";

export function ErrorPage() {
  const error = useRouteError();

  const heading =
    isRouteErrorResponse(error) && error.status === 404
      ? "Oops, this page does not exist!"
      : "Oops, you've found a glitch!";
  const paragraph =
    isRouteErrorResponse(error) && error.status === 404
      ? "It looks like the page you're looking for does not exist. That's a bummer! Why don't you start fresh by navigating to our home page?"
      : "It looks like the page you're looking for has been hacked by a mischievous robot. Don't worry, we'll get it fixed up in no time!";

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-md text-center">
        <img
          src="/hero-image-404.png"
          width="300"
          height="300"
          alt="404 Illustration"
          className="mx-auto"
          style={{ aspectRatio: "300/300", objectFit: "cover" }}
        />
        <h1 className="mt-8 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          {heading}
        </h1>
        <p className="mt-4 text-muted-foreground">{paragraph}</p>
        <div className="mt-6">
          <NavLink
            to="/"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            prefetch="intent"
          >
            <ArrowLeft className="mr-2 h-5 w-5" />
            Go Back Home
          </NavLink>
        </div>
      </div>
    </div>
  );
}
