import { LoaderFunctionArgs } from '@remix-run/server-runtime';
import { NavLink, useLoaderData } from '@remix-run/react';
import { CheckIcon } from 'lucide-react';
import { DefaultRightTopNav } from '~/modules/components/right-top-nav.tsx';
import { Card } from '~/modules/components/ui/card.tsx';
import { deserializeEvent, Event } from '~/modules/pocketbase/pocketbase.ts';
import { getEventBySlug, updateAttendeeCancellation } from '~/modules/pocketbase/api.server.ts';
import { trackEvent } from '~/modules/posthog/posthog.server.ts';
import { notFound } from '~/modules/responses.server.ts';
import { getImageSrc } from '~/modules/image-opt/utils.ts';

export async function loader({ params, request }: LoaderFunctionArgs) {
  const attendeeId = new URL(request.url).searchParams.get('attendee');
  if (!attendeeId) {
    throw notFound();
  }
  const { slug } = params;
  if (typeof slug !== 'string') {
    throw notFound();
  }
  const event = await getEventBySlug(slug);
  if (!event) {
    throw notFound();
  }
  await updateAttendeeCancellation(attendeeId, true);
  trackEvent('attendee canceled', event.slug, {
    attendee_id: attendeeId,
    event_name: event.name,
    event_id: event.id,
    type: 'website',
  });
  return { event };
}

export default function Component() {
  const { event } = useLoaderData<typeof loader>();
  return (
    <div className='flex flex-col min-h-[100dvh]'>
      <header className='px-4 lg:px-6 h-14 flex items-center'>
        <nav className='flex gap-4 sm:gap-6'>
          <NavLink
            to={`/${event.slug}`}
            className='text-sm font-medium hover:underline underline-offset-4'
          >
            Back to event
          </NavLink>
        </nav>
        <DefaultRightTopNav />
      </header>
      <main className='flex-1 items-center justify-center'>
        <section className='flex items-center justify-center w-full py-12 md:py-24 lg:py-32'>
          <div className='container'>
            <div className='grid gap-6 lg:grid-cols-[1fr_400px] lg:gap-12 xl:grid-cols-[1fr_600px]'>
              <div className='flex flex-col justify-center space-y-4'>
                <SuccessView event={deserializeEvent(event)} />
              </div>
              <img
                src={getImageSrc('/img/public/hero-image-goodbye.png', {
                  width: 550,
                  height: 550,
                  fit: 'cover',
                })}
                width='550'
                height='550'
                alt='A cartoon-style character, facing away from the camera, waves to a crowd entering a futuristic bus.'
                className='mx-auto aspect-video overflow-hidden rounded-xl object-cover sm:w-full lg:order-last lg:aspect-square'
              />
            </div>
          </div>
        </section>
      </main>
      <footer className='flex flex-col gap-2 sm:flex-row py-6 w-full shrink-0 items-center px-4 md:px-6 border-t'>
        <p className='text-xs text-muted-foreground'>
          &copy; 2024 All Things Web. All rights reserved.
        </p>
      </footer>
    </div>
  );
}

export function SuccessView({ event }: { event: Event }) {
  return (
    <Card className='mx-auto max-w-md p-6 flex flex-col items-center gap-4'>
      <div className='bg-green-500 rounded-full p-3 flex items-center justify-center'>
        <CheckIcon className='w-6 h-6 text-white' />
      </div>
      <div className='space-y-2 text-center'>
        <h3 className='text-xl font-semibold'>Attendance canceled!</h3>
        <p className='text-muted-foreground'>
          Thank you for letting us know that you can&apos;t make it to the
          {event.name}. We&apos;ve successfully canceled your attendance. We&apos;ll miss you at the event, but we hope
          to see you at the next one!
        </p>
      </div>
      <div className='flex flex-col items-center justify-center gap-1 space-y-2 text-center'>
        <NavLink
          to={`/${event.slug}`}
          className='inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'
          prefetch='intent'
        >
          Back to event
        </NavLink>
      </div>
    </Card>
  );
}
