import clsx from 'clsx';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import useEmblaCarousel from 'embla-carousel-react';
import type { Event } from '~/modules/allthingsweb/public-types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '~/modules/components/ui/card';
import { Skeleton } from '~/modules/components/ui/skeleton';
import { usePrevNextButtons } from '~/modules/components/ui/carousel';
import { Button, ButtonNavLink } from '~/modules/components/ui/button';
import { MapPinIcon } from '~/modules/components/ui/icons';
import { toReadableDateTimeStr } from '~/modules/datetime';

function SkeletonEventCard() {
  return (
    <Card className="h-full flex flex-col">
      <CardContent className="flex-grow p-6 space-y-4">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <div className="flex items-center space-x-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-1/4" />
        </div>
        <div className="flex items-center space-x-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </CardContent>
      <CardFooter className="p-6 pt-0">
        <Skeleton className="h-10 w-full" />
      </CardFooter>
    </Card>
  );
}

export function PendingEventsCarousel() {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false,
    align: 'start',
  });
  const { prevBtnDisabled, nextBtnDisabled, onPrevButtonClick, onNextButtonClick } = usePrevNextButtons(emblaApi);

  return (
    <div className="relative">
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex">
          {Array(4)
            .fill(0)
            .map((_, index) => (
              <div key={index} className="flex-[0_0_100%] min-w-0 sm:flex-[0_0_50%] lg:flex-[0_0_33.33%] px-4">
                <SkeletonEventCard />
              </div>
            ))}
        </div>
      </div>
      <Button
        variant="icon"
        size="icon"
        className={clsx('absolute -left-2 top-1/2 -translate-y-1/2 backdrop-blur-sm', {
          hidden: prevBtnDisabled,
        })}
        onClick={onPrevButtonClick}
      >
        <ChevronLeftIcon className="h-4 w-4 lg:h-6 lg:w-6" />
        <span className="sr-only">Previous slide</span>
      </Button>
      <Button
        variant="icon"
        size="icon"
        className={clsx('absolute -right-2 top-1/2 -translate-y-1/2 backdrop-blur-sm', {
          hidden: nextBtnDisabled,
        })}
        onClick={onNextButtonClick}
      >
        <ChevronRightIcon className="h-4 w-4 lg:h-6 lg:w-6" />
        <span className="sr-only">Next slide</span>
      </Button>
    </div>
  );
}

function EventCard({ event, className }: { event: Event; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{event.name}</CardTitle>
        <CardDescription>{event.tagline}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center space-x-2 text-sm text-muted-foreground">
          <CalendarIcon className="h-4 w-4" />
          <span>{toReadableDateTimeStr(event.start, true)}</span>
        </div>
        <div className="flex items-center space-x-2 text-sm text-muted-foreground mt-2">
          <MapPinIcon className="h-4 w-4" />
          <span>{event.shortLocation}</span>
        </div>
      </CardContent>
      <CardFooter>
        <ButtonNavLink to={`/${event.slug}`} variant="outline">
          See details
        </ButtonNavLink>
      </CardFooter>
    </Card>
  );
}

export function EventsCarousel({ events }: { events: Event[] }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false,
    align: 'start',
  });
  const { prevBtnDisabled, nextBtnDisabled, onPrevButtonClick, onNextButtonClick } = usePrevNextButtons(emblaApi);

  return (
    <div className="relative">
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex items-stretch">
          {events.map((event) => (
            <div key={event.id} className="flex-[0_0_100%] sm:flex-[0_0_50%] lg:flex-[0_0_33.33%] px-4">
              <EventCard className="h-full" event={event} />
            </div>
          ))}
        </div>
      </div>
      <Button
        variant="icon"
        size="icon"
        className={clsx('absolute -left-2 top-1/2 -translate-y-1/2 backdrop-blur-sm', {
          hidden: prevBtnDisabled,
        })}
        onClick={onPrevButtonClick}
      >
        <ChevronLeftIcon className="h-4 w-4 lg:h-6 lg:w-6" />
        <span className="sr-only">Previous slide</span>
      </Button>
      <Button
        variant="icon"
        size="icon"
        className={clsx('absolute -right-2 top-1/2 -translate-y-1/2 backdrop-blur-sm', {
          hidden: nextBtnDisabled,
        })}
        onClick={onNextButtonClick}
      >
        <ChevronRightIcon className="h-4 w-4 lg:h-6 lg:w-6" />
        <span className="sr-only">Next slide</span>
      </Button>
    </div>
  );
}
