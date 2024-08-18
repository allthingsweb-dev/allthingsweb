import { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { NavLink, useLoaderData } from "@remix-run/react";
import { DefaultRightTopNav } from "~/modules/components/right-top-nav";
import { getAttendeeCount, getEventBySlug } from "~/modules/pocketbase/pocketbase.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if(!data || !data.event) {
    return [{ title: "Event Not Found" }];
  }
  return [
    { title: `${data.event.name} | All Things Web` },
    { name: "description", content: data.event.tagline },
  ];
};

export async function loader({ params }: LoaderFunctionArgs) {
  const { slug } = params;
  if (typeof slug !== "string") {
    throw new Response("Not Found", { status: 404 });
  }
  const event = await getEventBySlug(slug);
  if (!event) {
    throw new Response("Not Found", { status: 404 });
  }
  const attendeeCount = await getAttendeeCount(event.id);
  return {
    event,
    isAtCapacity: !!event.attendeeLimit && attendeeCount >= event.attendeeLimit,
  };
}

export default function Component() {
  const { event, isAtCapacity } = useLoaderData<typeof loader>();
  return (
    <div className="flex flex-col min-h-[100dvh]">
      <header className="px-4 lg:px-6 h-14 flex items-center">
        <DefaultRightTopNav />
      </header>
      <main className="flex-1 items-center justify-center">
        <section className="flex items-center justify-center w-full py-12 md:py-24 lg:py-32">
          <div className="container px-4 md:px-6">
            <div className="grid gap-6 lg:grid-cols-[1fr_400px] lg:gap-12 xl:grid-cols-[1fr_600px]">
              <div className="flex flex-col justify-center space-y-4">
                <div className="space-y-2">
                  <h1 className="text-3xl font-bold tracking-tighter sm:text-5xl xl:text-6xl/none">
                    {event.name}
                  </h1>
                  <p className="max-w-[600px] text-muted-foreground md:text-xl">
                    {event.tagline}
                  </p>
                </div>
                <div className="flex flex-col gap-2 min-[400px]:flex-row">
                  <NavLink
                    to={`/${event.slug}/register`}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                    prefetch="intent"
                    aria-disabled={isAtCapacity}
                  >
                    Register Now
                  </NavLink>
                </div>
              </div>
              <img
                src="/hero-image-hackathon.png"
                width="550"
                height="550"
                alt="Hero"
                className="mx-auto aspect-video overflow-hidden rounded-xl object-cover sm:w-full lg:order-last lg:aspect-square"
              />
            </div>
          </div>
        </section>
        <section className="flex items-center justify-center w-full py-12 md:py-24 lg:py-32 bg-muted">
          <div className="container px-4 md:px-6">
            <div className="grid gap-6 lg:grid-cols-2 lg:gap-12">
              <div className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
                  When and Where
                </h2>
                <p className="max-w-[600px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
                  The Bay Area Hackathon will take place on June 10-12, 2023 at
                  the San Francisco Marriott Marquis. Join us for 48 hours of
                  coding, networking, and fun!
                </p>
              </div>
              <div id="prizes" className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
                  Prizes
                </h2>
                <p className="max-w-[600px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
                  The top three teams will receive cash prizes of $5,000,
                  $3,000, and $1,000 respectively. Additionally, there will be
                  special prizes for the best use of sponsor technologies.
                </p>
              </div>
              <div id="sponsors" className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
                  Sponsors
                </h2>
                <p className="max-w-[600px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
                  The Bay Area Hackathon is proudly sponsored by some of the
                  biggest names in tech, including Google, Amazon, and
                  Microsoft. Their support helps make this event possible.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="flex flex-col gap-2 sm:flex-row py-6 w-full shrink-0 items-center px-4 md:px-6 border-t">
        <p className="text-xs text-muted-foreground">
          &copy; 2024 All Things Web. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
