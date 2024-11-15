import { ActionFunctionArgs, LoaderFunctionArgs, redirect } from '@remix-run/node';
import { Label } from '~/modules/components/ui/label';
import { Input } from '~/modules/components/ui/input';
import { Button, ButtonAnchor } from '~/modules/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '~/modules/components/ui/card';
import { Form, NavLink, useActionData, useLoaderData, useNavigation, useParams } from '@remix-run/react';
import { CheckIcon, XIcon, CalendarIcon } from 'lucide-react';
import {
  getAttendeeByEmail,
  getAttendeeCount,
  getEventBySlug,
  registerAttendee,
  updateAttendeeCancellation,
} from '~/modules/pocketbase/api.server';
import { deserializeEvent, Event } from '~/modules/pocketbase/pocketbase';
import { LoadingSpinner, MapPinIcon } from '~/modules/components/ui/icons';
import { DefaultRightTopNav } from '~/modules/components/right-top-nav';
import { trackEvent } from '~/modules/posthog/posthog.server';
import { toReadableDateTimeStr } from '~/modules/datetime';
import { meta } from '~/modules/event-details/meta';
import { useCsrfToken } from '~/modules/session/csrf';
import { notFound } from '~/modules/responses.server';
import { requireValidCsrfToken } from '~/infrastructure/session/csrf.server';

export { meta };

export async function action({ request, params, context }: ActionFunctionArgs) {
  const session = await context.session.getUserSession(request);
  const { slug } = params;
  if (typeof slug !== 'string') {
    return notFound();
  }
  const event = await getEventBySlug(slug);
  if (!event) {
    return notFound();
  }
  if (!event.enableRegistrations) {
    return new Response('Registrations disabled. Use Luma.', { status: 400 });
  }
  const form = await request.formData();
  const csrfToken = form.get('csrf');
  await requireValidCsrfToken(session?.csrfToken, csrfToken);

  const email = form.get('email');
  const name = form.get('name');
  if (!email || !name || typeof email !== 'string' || typeof name !== 'string') {
    return new Response('Bad Request', { status: 400 });
  }

  const formAttendee = {
    email: email.trim().toLowerCase(),
    name: name.trim(),
  };
  const [existingAttendee, attendeeCount] = await Promise.all([
    getAttendeeByEmail(event.id, formAttendee.email),
    getAttendeeCount(event.id),
  ]);

  const alreadyRegistered = existingAttendee && !existingAttendee.canceled;
  if (!alreadyRegistered && attendeeCount >= event.attendeeLimit) {
    trackEvent('registration declined', event.slug, {
      attendee_id: existingAttendee?.id,
      event_name: event.name,
      event_id: event.id,
    });
    return { success: false, isAtCapacity: true };
  }

  let attendeeId = null;
  if (existingAttendee) {
    attendeeId = existingAttendee.id;
    if (existingAttendee.canceled) {
      await updateAttendeeCancellation(attendeeId, false);
      trackEvent('attendee uncanceled', event.slug, {
        attendee_id: attendeeId,
        event_name: event.name,
        event_id: event.id,
        type: 'website',
      });
    }
  } else {
    const attendee = await registerAttendee(event.id, formAttendee.name, formAttendee.email);
    attendeeId = attendee.id;
    trackEvent('attendee registered', event.slug, {
      attendee_id: attendeeId,
      event_name: event.name,
      event_id: event.id,
      type: 'website',
    });
  }

  context.services.inngestServer.publishEvent('event/attendee.registered', {
    attendee: {
      email: formAttendee.email,
      name: formAttendee.name,
      id: attendeeId,
    },
    eventSlug: event.slug,
  });

  return {
    success: true,
    hasAlreadyRegistered: !!existingAttendee,
    hasCanceled: existingAttendee?.canceled,
  };
}

export async function loader({ params }: LoaderFunctionArgs) {
  const { slug } = params;
  if (typeof slug !== 'string') {
    throw notFound();
  }
  const event = await getEventBySlug(slug);
  if (!event) {
    throw notFound();
  }
  if (!event.enableRegistrations) {
    return redirect(`/${event.slug}`);
  }
  const attendeeCount = await getAttendeeCount(event.id);
  return {
    event,
    isAtCapacity: attendeeCount >= event.attendeeLimit,
  };
}

export default function Component() {
  const { event: eventData, isAtCapacity } = useLoaderData<typeof loader>();
  const csrfToken = useCsrfToken();
  const event = deserializeEvent(eventData);
  const actionData = useActionData<typeof action>();
  return (
    <div className="flex flex-col min-h-[100dvh]">
      <header className="px-4 lg:px-6 h-14 flex items-center">
        <nav className="flex gap-4 sm:gap-6">
          <NavLink to={`/${event.slug}`} className="text-sm font-medium hover:underline underline-offset-4">
            Back to event
          </NavLink>
        </nav>
        <DefaultRightTopNav />
      </header>
      <main className="flex-1 items-center justify-center">
        <section className="flex items-center justify-center w-full py-6 md:py-24 lg:py-32">
          <div className="container">
            {!actionData && !isAtCapacity ? (
              <RegistrationForm csrfToken={csrfToken} event={event} />
            ) : !actionData && isAtCapacity ? (
              <EventFullErrorView event={event} />
            ) : actionData && !actionData.success ? (
              <EventFullErrorView event={event} />
            ) : (
              <SuccessView
                event={event}
                hasAlreadyRegistered={actionData?.hasAlreadyRegistered}
                hasCanceled={actionData?.hasCanceled}
              />
            )}
          </div>
        </section>
      </main>
      <footer className="flex flex-col gap-2 sm:flex-row py-6 w-full shrink-0 items-center px-4 md:px-6 border-t">
        <p className="text-xs text-muted-foreground">&copy; 2024 All Things Web. All rights reserved.</p>
      </footer>
    </div>
  );
}

export function SuccessView({
  event,
  hasAlreadyRegistered,
  hasCanceled,
}: {
  event: Event;
  hasAlreadyRegistered?: boolean;
  hasCanceled?: boolean;
}) {
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader className="flex flex-col items-center gap-4">
        <div className="bg-green-500 rounded-full p-3">
          <CheckIcon className="w-6 h-6 text-white" />
        </div>
        <CardTitle>Signup successful!</CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription>
          {!hasAlreadyRegistered && (
            <>
              Yay! You successfully signed up for the upcoming hackathon. 🎉 We&apos;ve sent you an email confirming
              your registration and to manage your attendance. Please use the cancel link in the email if you can&apos;t
              make it. See you there!
            </>
          )}
          {hasAlreadyRegistered && !hasCanceled && (
            <>
              Looks like you&apos;ve already signed up for this event. 🎉 You are all set! We re-sent your confirmation
              email. Please use the cancel link in the email if you can&apos;t make it. See you there!
            </>
          )}
          {hasAlreadyRegistered && hasCanceled && (
            <>
              Yay! You successfully signed up for the upcoming hackathon. 🎉 We revoked your cancellation and sent you
              an email confirming your registration. Thank you for being mindful of your attendance. 🙏 See you there!
            </>
          )}
        </CardDescription>
      </CardContent>
      <CardFooter className="flex flex-col lg:flex-row items-center justify-center gap-2 text-center">
        <NavLink
          to={`/${event.slug}`}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          prefetch="intent"
        >
          Back to event
        </NavLink>
        <NavLink
          to={`/${event.slug}/register`}
          className="inline-flex h-10 items-center justify-center rounded-md bg-secondary px-6 text-sm font-medium text-secondary-foreground shadow transition-colors hover:bg-secondary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          prefetch="intent"
        >
          Register another attendee
        </NavLink>
      </CardFooter>
    </Card>
  );
}

export function EventFullErrorView({ event }: { event: Event }) {
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader className="flex flex-col items-center gap-4">
        <div className="bg-red-500 rounded-full p-3">
          <XIcon className="w-6 h-6 text-white" />
        </div>
        <CardTitle>Event is full</CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription>
          Snap! The event is already full. We do not currently accept any more registrations. Please check back later
          for possible cancellations or future events. We appreciate your interest!
        </CardDescription>
      </CardContent>
      <CardFooter className="flex flex-col lg:flex-row items-center justify-center gap-2 text-center">
        <NavLink
          to={`/${event.slug}`}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          prefetch="intent"
        >
          Back to event
        </NavLink>
      </CardFooter>
    </Card>
  );
}

export function RegistrationForm({ csrfToken, event }: { csrfToken: string; event: Event }) {
  const navigation = useNavigation();
  const { slug } = useParams();
  const isSubmitting = navigation.formAction === `/${slug}/register`;
  return (
    <div className="mx-auto max-w-md space-y-6 py-12">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold">{event.name}</h1>
        <p className="text-muted-foreground">Join us for an exciting coding adventure!</p>
        <div className="flex justify-center items-center text-sm text-muted-foreground gap-4">
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4" />
            <span>{toReadableDateTimeStr(event.start, true)}</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPinIcon className="h-4 w-4" />
            <span>{event.shortLocation}</span>
          </div>
        </div>
      </div>
      <Form method="post" className="space-y-4" preventScrollReset={false}>
        <input type="hidden" name="csrf" value={csrfToken} />
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" placeholder="John Doe" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" placeholder="example@email.com" required />
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <LoadingSpinner />}
          Register
        </Button>
      </Form>
      {event.lumaEventId && (
        <>
          <div className="text-center text-sm text-muted-foreground">
            This event is managed via Luma and submitting this form will add your attendance on lu.ma. Of course, you
            can also sign up directly on Luma instead.
          </div>
          <ButtonAnchor
            href={event.lumaUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
            className="w-full"
          >
            View Event on Luma
          </ButtonAnchor>
        </>
      )}
    </div>
  );
}
