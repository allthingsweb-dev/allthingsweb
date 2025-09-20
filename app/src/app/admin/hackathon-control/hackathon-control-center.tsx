"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, Clock, Play, Vote, X } from "lucide-react";

interface HackathonEvent {
  id: string;
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  hackathonState: "before_start" | "hacking" | "voting" | "ended" | null;
  hackStartedAt: string | null;
  hackUntil: string | null;
  voteStartedAt: string | null;
  voteUntil: string | null;
}

const stateConfig = {
  before_start: {
    label: "Before Start",
    color: "bg-gray-100 text-gray-800",
    icon: Clock,
  },
  hacking: {
    label: "Hacking Time",
    color: "bg-blue-100 text-blue-800",
    icon: Play,
  },
  voting: {
    label: "Voting Time",
    color: "bg-yellow-100 text-yellow-800",
    icon: Vote,
  },
  ended: {
    label: "Ended",
    color: "bg-green-100 text-green-800",
    icon: CheckCircle,
  },
};

export function HackathonControlCenter() {
  const [events, setEvents] = useState<HackathonEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [selectedEvent, setSelectedEvent] = useState<HackathonEvent | null>(
    null,
  );
  const [hackathonState, setHackathonState] = useState<string>("");
  const [hackUntil, setHackUntil] = useState<string>("");
  const [voteUntil, setVoteUntil] = useState<string>("");
  const [timezone] = useState<string>("America/Los_Angeles"); // PDT/PST
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");

  // Fetch hackathon events
  useEffect(() => {
    async function fetchEvents() {
      try {
        const response = await fetch("/api/v1/admin/hackathon-control");
        if (!response.ok) {
          throw new Error("Failed to fetch events");
        }
        const data = await response.json();
        setEvents(data.data);
      } catch (err) {
        setError("Failed to load hackathon events");
        console.error(err);
      }
    }

    fetchEvents();
  }, []);

  // Update selected event when selection changes
  useEffect(() => {
    const event = events.find((e) => e.id === selectedEventId);
    setSelectedEvent(event || null);
    if (event) {
      setHackathonState(event.hackathonState || "before_start");
      // Convert UTC to local timezone for display
      setHackUntil(
        event.hackUntil
          ? new Date(event.hackUntil).toISOString().slice(0, 16)
          : "",
      );
      setVoteUntil(
        event.voteUntil
          ? new Date(event.voteUntil).toISOString().slice(0, 16)
          : "",
      );
    } else {
      setHackathonState("");
      setHackUntil("");
      setVoteUntil("");
    }
  }, [selectedEventId, events]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId || !hackathonState) return;

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const body: any = {
        eventId: selectedEventId,
        hackathonState,
      };

      if (hackUntil) {
        body.hackUntil = new Date(hackUntil).toISOString();
      }

      if (voteUntil) {
        body.voteUntil = new Date(voteUntil).toISOString();
      }

      const response = await fetch("/api/v1/admin/hackathon-control", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update hackathon state");
      }

      const result = await response.json();
      setSuccess("Hackathon state updated successfully!");

      // Refresh events list
      const refreshResponse = await fetch("/api/v1/admin/hackathon-control");
      if (refreshResponse.ok) {
        const refreshData = await refreshResponse.json();
        setEvents(refreshData.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return "Not set";
    return new Date(dateString).toLocaleString("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  };

  const getStateIcon = (state: string | null) => {
    if (!state || !(state in stateConfig)) return Clock;
    return stateConfig[state as keyof typeof stateConfig].icon;
  };

  const getStateColor = (state: string | null) => {
    if (!state || !(state in stateConfig))
      return stateConfig.before_start.color;
    return stateConfig[state as keyof typeof stateConfig].color;
  };

  const getStateLabel = (state: string | null) => {
    if (!state || !(state in stateConfig)) return "Before Start";
    return stateConfig[state as keyof typeof stateConfig].label;
  };

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <X className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Control Panel */}
        <Card>
          <CardHeader>
            <CardTitle>Hackathon Control Panel</CardTitle>
            <CardDescription>
              Select a hackathon and update its state and timing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="event-select">Select Hackathon</Label>
                <Select
                  value={selectedEventId}
                  onValueChange={setSelectedEventId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a hackathon event" />
                  </SelectTrigger>
                  <SelectContent>
                    {events.map((event) => (
                      <SelectItem key={event.id} value={event.id}>
                        {event.name} ({new Date(event.startDate).getFullYear()})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedEvent && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="state-select">Hackathon State</Label>
                    <Select
                      value={hackathonState}
                      onValueChange={setHackathonState}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select state" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="before_start">
                          Before Start
                        </SelectItem>
                        <SelectItem value="hacking">Hacking Time</SelectItem>
                        <SelectItem value="voting">Voting Time</SelectItem>
                        <SelectItem value="ended">Ended</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="hack-until">Hack Until (PDT)</Label>
                    <Input
                      id="hack-until"
                      type="datetime-local"
                      value={hackUntil}
                      onChange={(e) => setHackUntil(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="vote-until">Vote Until (PDT)</Label>
                    <Input
                      id="vote-until"
                      type="datetime-local"
                      value={voteUntil}
                      onChange={(e) => setVoteUntil(e.target.value)}
                    />
                  </div>

                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Updating..." : "Update Hackathon State"}
                  </Button>
                </>
              )}
            </form>
          </CardContent>
        </Card>

        {/* Event Details */}
        {selectedEvent && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {selectedEvent.name}
                <Badge className={getStateColor(selectedEvent.hackathonState)}>
                  {getStateLabel(selectedEvent.hackathonState)}
                </Badge>
              </CardTitle>
              <CardDescription>Current hackathon details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Event Dates</Label>
                <p className="text-sm text-gray-600">
                  {formatDateTime(selectedEvent.startDate)} -{" "}
                  {formatDateTime(selectedEvent.endDate)}
                </p>
              </div>

              <div>
                <Label className="text-sm font-medium">Hack Started At</Label>
                <p className="text-sm text-gray-600">
                  {formatDateTime(selectedEvent.hackStartedAt)}
                </p>
              </div>

              <div>
                <Label className="text-sm font-medium">Hack Until</Label>
                <p className="text-sm text-gray-600">
                  {formatDateTime(selectedEvent.hackUntil)}
                </p>
              </div>

              <div>
                <Label className="text-sm font-medium">Vote Started At</Label>
                <p className="text-sm text-gray-600">
                  {formatDateTime(selectedEvent.voteStartedAt)}
                </p>
              </div>

              <div>
                <Label className="text-sm font-medium">Vote Until</Label>
                <p className="text-sm text-gray-600">
                  {formatDateTime(selectedEvent.voteUntil)}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* All Events Overview */}
      <Card>
        <CardHeader>
          <CardTitle>All Hackathon Events</CardTitle>
          <CardDescription>
            Overview of all hackathon events and their current states
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {events.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                No hackathon events found
              </p>
            ) : (
              events.map((event) => {
                const StateIcon = getStateIcon(event.hackathonState);
                return (
                  <div
                    key={event.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-3">
                      <StateIcon className="h-5 w-5 text-gray-500" />
                      <div>
                        <h4 className="font-medium">{event.name}</h4>
                        <p className="text-sm text-gray-500">
                          {new Date(event.startDate).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <Badge className={getStateColor(event.hackathonState)}>
                      {getStateLabel(event.hackathonState)}
                    </Badge>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
