import {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { Label } from "~/modules/components/ui/label";
import { Input } from "~/modules/components/ui/input";
import { Button } from "~/modules/components/ui/button";
import { Card } from "~/modules/components/ui/card";
import {
  Form,
  NavLink,
  useActionData,
  useLoaderData,
  useNavigation,
  useParams,
} from "@remix-run/react";
import {
  getAttendeeByEmail,
  getAttendeeCount,
  getEventBySlug,
  registerAttendee,
  updateAttendeeCancellation,
} from "~/modules/pocketbase/pocketbase.server";
import { toEvent, Event } from "~/modules/pocketbase/pocketbase";
import { getSuccessfulEventSignupHtml } from "~/modules/email/templates";
import { sendEmail } from "~/modules/email/resend.server";
import { CheckIcon, LoadingSpinner, XIcon } from "~/modules/components/ui/icons";
import { DefaultRightTopNav } from "~/modules/components/right-top-nav";
import { env } from "~/modules/env";
import { trackEvent } from "~/modules/posthog/posthog.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data || !data.event) {
    return [{ title: "Event Not Found" }];
  }
  return [
    { title: `${data.event.name} | All Things Web` },
    { name: "description", content: data.event.tagline },
  ];
};

export async function action({ request, params }: ActionFunctionArgs) {
  const { slug } = params;
  if (typeof slug !== "string") {
    return new Response("Not Found", { status: 404 });
  }
  const event = await getEventBySlug(slug);
  if (!event) {
    return new Response("Not Found", { status: 404 });
  }
  const form = await request.formData();
  const email = form.get("email");
  const name = form.get("name");
  if (
    !email ||
    !name ||
    typeof email !== "string" ||
    typeof name !== "string"
  ) {
    return new Response("Bad Request", { status: 400 });
  }

  const [existingAttendee, attendeeCount] = await Promise.all([
    getAttendeeByEmail(event.id, email),
    getAttendeeCount(event.id),
  ]);

  const alreadyRegistered = existingAttendee && !existingAttendee.canceled;
  if (
    !alreadyRegistered &&
    event.attendeeLimit &&
    attendeeCount >= event.attendeeLimit
  ) {
    trackEvent("registration declined", event.slug, {
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
      trackEvent("attendee uncanceled", event.slug, {
        attendee_id: attendeeId,
        event_name: event.name,
        event_id: event.id,
      });
    }
  } else {
    const attendee = await registerAttendee(event.id, name, email);
    attendeeId = attendee.id;
    trackEvent("attendee registered", event.slug, {
      attendee_id: attendeeId,
      event_name: event.name,
      event_id: event.id,
    });
  }

  const html = getSuccessfulEventSignupHtml(name, attendeeId, event, env.server.origin);
  sendEmail({
    from: {
      name: "Team",
      email: "events@allthingsweb.dev",
    },
    to: [email],
    subject: `${event.name} - You're in!`,
    html,
  });

  return {
    success: true,
    hasAlreadyRegistered: !!existingAttendee,
    hasCanceled: existingAttendee?.canceled,
  };
}

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
  const actionData = useActionData<typeof action>();
  return (
    <div className="flex flex-col min-h-[100dvh]">
      <header className="px-4 lg:px-6 h-14 flex items-center">
        <nav className="flex gap-4 sm:gap-6">
          <NavLink
            to={`/${event.slug}`}
            className="text-sm font-medium hover:underline underline-offset-4"
          >
            Back to event
          </NavLink>
        </nav>
        <DefaultRightTopNav />
      </header>
      <main className="flex-1 items-center justify-center">
        <section className="flex items-center justify-center w-full py-12 md:py-24 lg:py-32">
          <div className="container px-4 md:px-6">
            <div className="grid gap-6 lg:grid-cols-[1fr_400px] lg:gap-12 xl:grid-cols-[1fr_600px]">
              <div className="flex flex-col justify-center space-y-4">
                {!actionData ? (
                  <RegistrationForm />
                ) : !actionData && isAtCapacity ? (
                  <EventFullErrorView event={toEvent(event)} />
                ) : actionData && !actionData.success ? (
                  <EventFullErrorView event={toEvent(event)} />
                ) : (
                  <SuccessView
                    event={toEvent(event)}
                    hasAlreadyRegistered={actionData?.hasAlreadyRegistered}
                    hasCanceled={actionData?.hasCanceled}
                  />
                )}
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
      </main>
      <footer className="flex flex-col gap-2 sm:flex-row py-6 w-full shrink-0 items-center px-4 md:px-6 border-t">
        <p className="text-xs text-muted-foreground">
          &copy; 2024 All Things Web. All rights reserved.
        </p>
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
    <Card className="mx-auto max-w-md p-6 flex flex-col items-center gap-4">
      <div className="bg-green-500 rounded-full p-3 flex items-center justify-center">
        <CheckIcon className="w-6 h-6 text-white" />
      </div>
      <div className="space-y-2 text-center">
        <h3 className="text-xl font-semibold">Signup successful!</h3>
        {!hasAlreadyRegistered && (
          <p className="text-muted-foreground">
            Yay! You successfully signed up for the upcoming hackathon. 🎉
            We&apos;ve sent you an email confirming your registration and to
            manage your attendance. Please use the cancel link in the email if
            you can&apos;t make it. See you there!
          </p>
        )}
        {hasAlreadyRegistered && !hasCanceled && (
          <p className="text-muted-foreground">
            Looks like you&apos;ve already signed up for this event. 🎉 You are
            all set! We re-sent your confirmation email. Please use the cancel
            link in the email if you can&apos;t make it. See you there!
          </p>
        )}
        {hasAlreadyRegistered && hasCanceled && (
          <p className="text-muted-foreground">
            Yay! You successfully signed up for the upcoming hackathon. 🎉 We
            revoked your cancellation and sent you an email confirming your
            registration. Thank you for being mindful of your attendance. 🙏 See
            you there!
          </p>
        )}
      </div>
      <div className="flex flex-col items-center justify-center gap-1 space-y-2 text-center">
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
      </div>
    </Card>
  );
}



export function EventFullErrorView({ event }: { event: Event }) {
  return (
    <Card className="mx-auto max-w-md p-6 flex flex-col items-center gap-4">
      <div className="bg-red-500 rounded-full p-3 flex items-center justify-center">
        <XIcon className="w-6 h-6 text-white" />
      </div>
      <div className="space-y-2 text-center">
        <h3 className="text-xl font-semibold">Event is full</h3>
        <p className="text-muted-foreground">
          Snap! The event is already full. We do not currently accept any
          more registrations. Please check back later for possible cancellations
          or future events. We appreciate your interest!
        </p>
      </div>
      <div className="flex flex-col items-center justify-center gap-1 space-y-2 text-center">
        <NavLink
          to={`/${event.slug}`}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          prefetch="intent"
        >
          Back to event
        </NavLink>
      </div>
    </Card>
  );
}

export function RegistrationForm() {
  const navigation = useNavigation();
  const { slug } = useParams();
  const isSubmitting = navigation.formAction === `/${slug}/register`;
  return (
    <div className="mx-auto max-w-md space-y-6 py-12">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold">Sign up for the hackathon</h1>
        <p className="text-muted-foreground">
          Enter your information to register for the upcoming hackathon.
        </p>
      </div>
      <Form method="post" className="space-y-4" preventScrollReset={false}>
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input name="name" placeholder="John Doe" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            name="email"
            type="email"
            placeholder="example@email.com"
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <LoadingSpinner />} 
          Register
        </Button>
      </Form>
    </div>
  );
}
