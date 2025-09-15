import Link from "next/link";
import NextImage from "next/image";
import { stackServerApp } from "@/lib/stack";
import { isAdmin } from "@/lib/admin";
import { getAllEventImagesWithDetails } from "@/lib/images";
import { PageLayout } from "@/components/page-layout";
import { Section } from "@/components/ui/section";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/admin/copy-button";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { toReadableDateTimeStr } from "@/lib/datetime";

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
          <div className="space-y-8">
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
                        <div key={image.imageId} className="space-y-3">
                          {/* Image Preview */}
                          <div className="relative group">
                            <NextImage
                              src={image.imageUrl}
                              alt={image.imageAlt}
                              width={700}
                              height={700}
                              className="w-full h-48 object-cover rounded-lg border shadow-sm"
                              placeholder="blur"
                              blurDataURL={image.imagePlaceholder}
                            />
                            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 transition-opacity rounded-lg" />
                          </div>

                          {/* Image Details */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-gray-500">
                                Image ID
                              </span>
                              <CopyButton
                                text={image.imageId}
                                className="text-xs text-gray-600 hover:text-gray-900"
                              >
                                <span className="font-mono">
                                  {image.imageId.slice(0, 8)}...
                                </span>
                              </CopyButton>
                            </div>

                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-gray-500">
                                Dimensions
                              </span>
                              <span className="text-xs text-gray-600">
                                {image.imageWidth} × {image.imageHeight}
                              </span>
                            </div>

                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-medium text-gray-500">
                                  URL
                                </span>
                                <CopyButton
                                  text={image.imageUrl}
                                  className="text-xs text-gray-600 hover:text-gray-900"
                                  title="Copy URL to clipboard"
                                />
                              </div>
                              <div className="text-xs text-gray-600 break-all font-mono bg-gray-50 p-2 rounded border">
                                {image.imageUrl.length > 60
                                  ? `${image.imageUrl.slice(0, 30)}...${image.imageUrl.slice(-30)}`
                                  : image.imageUrl}
                              </div>
                            </div>

                            {image.imageAlt && (
                              <div>
                                <span className="text-xs font-medium text-gray-500">
                                  Alt Text
                                </span>
                                <div className="text-xs text-gray-600 mt-1">
                                  {image.imageAlt}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </Section>
    </PageLayout>
  );
}
