import Link from "next/link";
import { stackServerApp } from "@/lib/stack";
import { isAdmin } from "@/lib/admin";
import { getAllEventImagesWithDetails } from "@/lib/images";
import { PageLayout } from "@/components/page-layout";
import { Section } from "@/components/ui/section";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { toReadableDateTimeStr } from "@/lib/datetime";
import { AdminImagesClient } from "./admin-images-client";

export default async function AdminImagesPage() {
  // Check if user is logged in, redirect to login if not
  const user = await stackServerApp.getUser({ or: "redirect" });

  // Check if user is admin
  const userIsAdmin = await isAdmin(user.id);

  if (!userIsAdmin) {
    return (
      <PageLayout>
        <Section>
          <div className="container max-w-md mx-auto">
            <div className="bg-white shadow-lg rounded-lg p-6">
              <div className="text-center">
                <h1 className="text-2xl font-bold text-red-600 mb-4">
                  Access Denied
                </h1>
                <p className="text-gray-600 mb-4">
                  You do not have administrator privileges to access this page.
                </p>
                <Button asChild>
                  <Link href="/">Go to Home</Link>
                </Button>
              </div>
            </div>
          </div>
        </Section>
      </PageLayout>
    );
  }

  const eventImages = await getAllEventImagesWithDetails();

  // Group images by event
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
        images: typeof eventImages;
      }
    >,
  );

  const sortedEvents = Object.entries(imagesByEvent).sort(
    ([, a], [, b]) => b.eventStartDate.getTime() - a.eventStartDate.getTime(),
  );

  return (
    <PageLayout>
      <Section>
        <div className="container max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin" className="flex items-center gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back to Admin
              </Link>
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Event Images</h1>
              <p className="text-gray-600 mt-1">
                View all uploaded event images with details
              </p>
            </div>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-blue-600">
                  {eventImages.length}
                </div>
                <div className="text-sm text-gray-600">Total Images</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-green-600">
                  {sortedEvents.length}
                </div>
                <div className="text-sm text-gray-600">Events with Images</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-purple-600">
                  {Math.round(
                    eventImages.length / Math.max(sortedEvents.length, 1),
                  )}
                </div>
                <div className="text-sm text-gray-600">
                  Avg Images per Event
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Events and Images */}
          <AdminImagesClient
            initialEventImages={eventImages}
            sortedEvents={sortedEvents}
          />
        </div>
      </Section>
    </PageLayout>
  );
}
