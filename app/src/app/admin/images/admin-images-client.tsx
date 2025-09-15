"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { toReadableDateTimeStr } from "@/lib/datetime";
import { EventImageCard } from "@/components/admin/event-image-card";
import type { EventImageWithDetails } from "@/lib/images";

interface AdminImagesClientProps {
  initialEventImages: EventImageWithDetails[];
  sortedEvents: [
    string,
    {
      eventName: string;
      eventSlug: string;
      eventStartDate: Date;
      images: EventImageWithDetails[];
    },
  ][];
}

export function AdminImagesClient({
  initialEventImages,
  sortedEvents: initialSortedEvents,
}: AdminImagesClientProps) {
  const [eventImages, setEventImages] = useState(initialEventImages);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Recalculate sorted events based on current eventImages
  const imagesByEvent = eventImages.reduce(
    (acc, image) => {
      const eventKey = image.eventId;
      if (!acc[eventKey]) {
        acc[eventKey] = {
          eventName: image.eventName,
          eventSlug: image.eventSlug,
          eventStartDate: image.eventStartDate,
          images: [],
        };
      }
      acc[eventKey].images.push(image);
      return acc;
    },
    {} as Record<
      string,
      {
        eventName: string;
        eventSlug: string;
        eventStartDate: Date;
        images: EventImageWithDetails[];
      }
    >,
  );

  const sortedEvents = Object.entries(imagesByEvent).sort(
    ([, a], [, b]) => b.eventStartDate.getTime() - a.eventStartDate.getTime(),
  );

  const handleDeleteImage = async (imageId: string) => {
    setMessage(null);

    try {
      const response = await fetch("/api/v1/admin/delete-event-image", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete image");
      }

      // Remove the deleted image from the state
      setEventImages((prevImages) =>
        prevImages.filter((img) => img.imageId !== imageId),
      );

      setMessage({
        type: "success",
        text: "Image deleted successfully!",
      });

      // Auto-hide success message after 3 seconds
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to delete image",
      });
    }
  };

  return (
    <div className="space-y-8">
      {/* Message Display */}
      {message && (
        <div
          className={`p-4 rounded-md ${
            message.type === "success"
              ? "bg-green-50 border border-green-200 text-green-800"
              : "bg-red-50 border border-red-200 text-red-800"
          }`}
        >
          {message.text}
        </div>
      )}

      {sortedEvents.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-gray-600">No event images found.</p>
          </CardContent>
        </Card>
      ) : (
        sortedEvents.map(([eventId, eventData]) => (
          <Card key={eventId}>
            <CardHeader className="border-b">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-xl mb-2 flex items-center gap-3">
                    <Link
                      href={`/${eventData.eventSlug}`}
                      className="hover:text-primary transition-colors"
                    >
                      {eventData.eventName}
                    </Link>
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        href={`/${eventData.eventSlug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </Button>
                  </CardTitle>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <span>
                      {toReadableDateTimeStr(eventData.eventStartDate)}
                    </span>
                    <Badge variant="secondary">
                      {eventData.images.length} image
                      {eventData.images.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {eventData.images.map((image) => (
                  <EventImageCard
                    key={image.imageId}
                    image={image}
                    showDelete={true}
                    onDelete={handleDeleteImage}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
