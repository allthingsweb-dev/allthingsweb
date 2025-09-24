"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLiveQuery, eq } from "@tanstack/react-db";
import { eventsCollection } from "@/lib/collections";
import type { ClientUser } from "@/lib/client-user";
import { BeforeStartDashboard } from "./before-start-dashboard";
import { HackingTimeDashboard } from "./hacking-time-dashboard";
import { VotingTimeDashboard } from "./voting-time-dashboard";
import { EndedDashboard } from "./ended-dashboard";

interface HackathonDashboardProps {
  eventSlug: string;
  user: ClientUser;
  isAdmin: boolean;
}

type HackathonState = "before_start" | "hacking" | "voting" | "ended";

export function HackathonDashboard({
  eventSlug,
  user,
  isAdmin,
}: HackathonDashboardProps) {
  const [hackathonState, setHackathonState] =
    useState<HackathonState>("before_start");

  // Get the event data from the reactive collection
  const { data: events } = useLiveQuery((q) =>
    q
      .from({ event: eventsCollection })
      .where(({ event }) => eq(event.slug, eventSlug)),
  );

  const event = events?.[0];

  // Determine hackathon state based on event data and current time
  useEffect(() => {
    if (!event) return;

    const determineState = () => {
      const now = new Date();

      // If we have explicit hackathon state from database, use it
      if (event.hackathon_state) {
        setHackathonState(event.hackathon_state as HackathonState);
        return;
      }

      // Fallback to time-based logic
      const eventStart = new Date(event.start_date);
      const eventEnd = new Date(event.end_date);

      if (now < eventStart) {
        setHackathonState("before_start");
      } else if (now < eventEnd) {
        // Default to hacking time if no explicit state
        setHackathonState("hacking");
      } else {
        setHackathonState("ended");
      }
    };

    determineState();

    // Update state every minute in case of time-based transitions
    const interval = setInterval(determineState, 60000);

    return () => clearInterval(interval);
  }, [event]);

  // Transform the event data to match the expected ExpandedEvent format
  const transformedEvent = event
    ? {
        id: event.id,
        name: event.name,
        startDate: new Date(event.start_date),
        endDate: new Date(event.end_date),
        slug: event.slug,
        tagline: event.tagline,
        attendeeLimit: event.attendee_limit,
        streetAddress: event.street_address,
        shortLocation: event.short_location,
        fullAddress: event.full_address,
        lumaEventUrl: event.luma_event_id
          ? `https://lu.ma/${event.luma_event_id}`
          : null,
        lumaEventId: event.luma_event_id,
        isHackathon: event.is_hackathon,
        isDraft: event.is_draft,
        highlightOnLandingPage: event.highlight_on_landing_page,
        previewImage: event.preview_image
          ? {
              url: event.preview_image,
              alt: event.name + " preview image",
              width: null,
              height: null,
            }
          : null,
        recordingUrl: event.recording_url,
        hackathonState: event.hackathon_state,
        hackStartedAt: event.hack_started_at
          ? new Date(event.hack_started_at)
          : null,
        hackUntil: event.hack_until ? new Date(event.hack_until) : null,
        voteStartedAt: event.vote_started_at
          ? new Date(event.vote_started_at)
          : null,
        voteUntil: event.vote_until ? new Date(event.vote_until) : null,
        createdAt: new Date(event.created_at),
        updatedAt: new Date(event.updated_at),
        // These fields are not available in the events collection but are needed for compatibility
        hacks: [],
        talks: [],
        speakers: [],
        sponsors: [],
        images: [],
      }
    : null;

  const renderDashboardForState = () => {
    if (!transformedEvent) {
      return (
        <div className="min-h-screen bg-background w-full flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading event data...</p>
          </div>
        </div>
      );
    }

    const commonProps = { event: transformedEvent, user, isAdmin };

    switch (hackathonState) {
      case "before_start":
        return <BeforeStartDashboard {...commonProps} />;
      case "hacking":
        return <HackingTimeDashboard {...commonProps} />;
      case "voting":
        return (
          <VotingTimeDashboard
            event={transformedEvent}
            user={user}
            isAdmin={isAdmin}
          />
        );
      case "ended":
        return <EndedDashboard {...commonProps} />;
      default:
        return <BeforeStartDashboard {...commonProps} />;
    }
  };

  return (
    <div className="min-h-screen bg-background w-full">
      {/* Header */}
      <div className="bg-card shadow-sm border-b w-full">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link
                href={`/${eventSlug}`}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Event
              </Link>
              <div className="h-6 w-px bg-border" />
              <div className="min-w-0 flex-1">
                <h1 className="text-lg font-semibold text-foreground truncate">
                  {transformedEvent?.name || "Loading..."}
                </h1>
                <p className="text-sm text-muted-foreground">
                  Hackathon Dashboard
                </p>
              </div>
            </div>

            {/* State indicator */}
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-sm font-medium text-foreground capitalize">
                  {hackathonState.replace("_", " ")}
                </div>
                <div className="text-xs text-muted-foreground">
                  Welcome, {user.displayName || user.primaryEmail}
                </div>
              </div>
              <div
                className={`w-3 h-3 rounded-full ${
                  hackathonState === "before_start"
                    ? "bg-gray-400"
                    : hackathonState === "hacking"
                      ? "bg-blue-500"
                      : hackathonState === "voting"
                        ? "bg-yellow-500"
                        : "bg-green-500"
                }`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Dashboard Content */}
      <div className="w-full py-8">{renderDashboardForState()}</div>
    </div>
  );
}
