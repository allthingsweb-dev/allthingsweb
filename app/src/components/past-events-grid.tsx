"use client";

import { useState, useMemo } from "react";
import { CalendarIcon, MapPinIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import NextImage from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EventWithImages } from "@/lib/images";
import { toReadableDateTimeStr, toYearStr } from "@/lib/datetime";

interface PastEventsGridProps {
  events: EventWithImages[];
}

export function PastEventsGrid({ events }: PastEventsGridProps) {
  const [searchQuery, setSearchQuery] = useState("");

  // Filter events based on search query
  const filteredEvents = useMemo(() => {
    if (!searchQuery.trim()) return events;

    const query = searchQuery.toLowerCase().trim();
    return events.filter((eventWithImages) => {
      // Search in title
      if (eventWithImages.event.name.toLowerCase().includes(query)) return true;

      // Search in date (year, month, or formatted date)
      const eventDate = new Date(eventWithImages.event.startDate);
      const year = eventDate.getFullYear().toString();
      const month = eventDate
        .toLocaleDateString("en-US", { month: "long" })
        .toLowerCase();
      const shortMonth = eventDate
        .toLocaleDateString("en-US", { month: "short" })
        .toLowerCase();
      const formattedDate = toReadableDateTimeStr(
        eventDate,
        false,
      ).toLowerCase();

      return (
        year.includes(query) ||
        month.includes(query) ||
        shortMonth.includes(query) ||
        formattedDate.includes(query)
      );
    });
  }, [events, searchQuery]);

  // Group events by year
  const eventsByYear = useMemo(() => {
    const grouped = filteredEvents.reduce(
      (acc, eventWithImages) => {
        const year = toYearStr(new Date(eventWithImages.event.startDate));
        if (!acc[year]) {
          acc[year] = [];
        }
        acc[year].push(eventWithImages);
        return acc;
      },
      {} as Record<string, EventWithImages[]>,
    );

    // Sort years in descending order
    const sortedYears = Object.keys(grouped).sort(
      (a, b) => parseInt(b) - parseInt(a),
    );
    return sortedYears.map((year) => ({
      year,
      events: grouped[year],
    }));
  }, [filteredEvents]);

  return (
    <div className="space-y-8">
      {/* Search Bar */}
      <div className="relative max-w-md mx-auto">
        <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
        <Input
          type="text"
          placeholder="Search by title or date..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Results count */}
      {searchQuery.trim() && (
        <p className="text-center text-muted-foreground">
          Found {filteredEvents.length} event
          {filteredEvents.length !== 1 ? "s" : ""}
        </p>
      )}

      {/* Events grouped by year */}
      {eventsByYear.map(({ year, events: yearEvents }) => (
        <div key={year} className="space-y-6">
          <h3 className="text-2xl font-bold text-center">{year}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {yearEvents.map((eventWithImages) => (
              <EventGridCard
                key={eventWithImages.event.id}
                eventWithImages={eventWithImages}
              />
            ))}
          </div>
        </div>
      ))}

      {/* No results message */}
      {filteredEvents.length === 0 && searchQuery.trim() && (
        <div className="text-center py-12">
          <p className="text-muted-foreground text-lg">
            No events found matching "{searchQuery}"
          </p>
          <Button
            variant="outline"
            onClick={() => setSearchQuery("")}
            className="mt-4"
          >
            Clear search
          </Button>
        </div>
      )}
    </div>
  );
}

function EventGridCard({
  eventWithImages,
}: {
  eventWithImages: EventWithImages;
}) {
  const { event, previewImage, additionalImages } = eventWithImages;

  // Get up to 2 images to display - only use event images, not preview image
  // Select first and last event images for better variety
  let imagesToShow = additionalImages;
  if (additionalImages.length >= 2) {
    imagesToShow = [
      additionalImages[0],
      additionalImages[additionalImages.length - 1],
    ];
  }

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      {/* Event Images */}
      <div className="relative w-full h-48 overflow-hidden">
        {imagesToShow.length > 0 ? (
          imagesToShow.length === 1 ? (
            // Single image
            <NextImage
              src={imagesToShow[0].url}
              alt={imagesToShow[0].alt}
              fill
              className="object-cover transition-transform hover:scale-105"
              placeholder={imagesToShow[0].placeholder ? "blur" : undefined}
              blurDataURL={imagesToShow[0].placeholder || undefined}
              sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
          ) : (
            // Two images side by side
            <div className="flex h-full">
              <div className="relative flex-1 overflow-hidden">
                <NextImage
                  src={imagesToShow[0].url}
                  alt={imagesToShow[0].alt}
                  fill
                  className="object-cover transition-transform hover:scale-105"
                  placeholder={imagesToShow[0].placeholder ? "blur" : undefined}
                  blurDataURL={imagesToShow[0].placeholder || undefined}
                  sizes="(max-width: 768px) 50vw, (max-width: 1024px) 25vw, 16.5vw"
                />
              </div>
              <div className="relative flex-1 overflow-hidden border-l">
                <NextImage
                  src={imagesToShow[1].url}
                  alt={imagesToShow[1].alt}
                  fill
                  className="object-cover transition-transform hover:scale-105"
                  placeholder={imagesToShow[1].placeholder ? "blur" : undefined}
                  blurDataURL={imagesToShow[1].placeholder || undefined}
                  sizes="(max-width: 768px) 50vw, (max-width: 1024px) 25vw, 16.5vw"
                />
              </div>
            </div>
          )
        ) : (
          // Placeholder when no images are available
          <div className="w-full h-full bg-muted flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <CalendarIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm font-medium">{event.name}</p>
            </div>
          </div>
        )}
      </div>

      <CardHeader className="flex-grow">
        <CardTitle className="line-clamp-2">{event.name}</CardTitle>
        <CardDescription className="line-clamp-3">
          {event.tagline}
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="space-y-2">
          <div className="flex items-center space-x-2 text-sm text-muted-foreground">
            <CalendarIcon className="h-4 w-4 flex-shrink-0" />
            <span>
              {toReadableDateTimeStr(new Date(event.startDate), false)}
            </span>
          </div>
          <div className="flex items-center space-x-2 text-sm text-muted-foreground">
            <MapPinIcon className="h-4 w-4 flex-shrink-0" />
            <span className="line-clamp-1">
              {event.shortLocation || "Location TBD"}
            </span>
          </div>
        </div>

        <div className="mt-4">
          <Button variant="outline" size="sm" asChild className="w-full">
            <Link href={`/${event.slug}`}>View Details</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
