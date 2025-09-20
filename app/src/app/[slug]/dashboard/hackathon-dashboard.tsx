"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ExpandedEvent } from "@/lib/expanded-events";
import type { ClientUser } from "@/lib/client-user";
import { BeforeStartDashboard } from "./before-start-dashboard";
import { HackingTimeDashboard } from "./hacking-time-dashboard";
import { VotingTimeDashboard } from "./voting-time-dashboard";
import { EndedDashboard } from "./ended-dashboard";

interface HackathonDashboardProps {
  event: ExpandedEvent;
  user: ClientUser;
  isAdmin: boolean;
}

type HackathonState = "before_start" | "hacking" | "voting" | "ended";

export function HackathonDashboard({
  event,
  user,
  isAdmin,
}: HackathonDashboardProps) {
  const [hackathonState, setHackathonState] =
    useState<HackathonState>("before_start");

  // Determine hackathon state based on event data and current time
  useEffect(() => {
    const determineState = () => {
      const now = new Date();

      // If we have explicit hackathon state from database, use it
      if (event.hackathonState) {
        setHackathonState(event.hackathonState as HackathonState);
        return;
      }

      // Fallback to time-based logic
      const eventStart = new Date(event.startDate);
      const eventEnd = new Date(event.endDate);

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

  const renderDashboardForState = () => {
    const commonProps = { event, user, isAdmin };

    switch (hackathonState) {
      case "before_start":
        return <BeforeStartDashboard {...commonProps} />;
      case "hacking":
        return <HackingTimeDashboard {...commonProps} />;
      case "voting":
        return <VotingTimeDashboard {...commonProps} />;
      case "ended":
        return <EndedDashboard {...commonProps} />;
      default:
        return <BeforeStartDashboard {...commonProps} />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 w-full">
      {/* Header */}
      <div className="bg-white shadow-sm border-b w-full">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link
                href={`/${event.slug}`}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Event
              </Link>
              <div className="h-6 w-px bg-gray-300" />
              <div>
                <h1 className="text-lg font-semibold text-gray-900">
                  {event.name}
                </h1>
                <p className="text-sm text-gray-500">Hackathon Dashboard</p>
              </div>
            </div>

            {/* State indicator */}
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-sm font-medium text-gray-900 capitalize">
                  {hackathonState.replace("_", " ")}
                </div>
                <div className="text-xs text-gray-500">
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
      <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
        {renderDashboardForState()}
      </div>
    </div>
  );
}
