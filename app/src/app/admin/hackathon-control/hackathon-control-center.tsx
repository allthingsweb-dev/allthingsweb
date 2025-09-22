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
import {
  CheckCircle,
  Clock,
  Play,
  Vote,
  X,
  Plus,
  Edit,
  Trash2,
  Trophy,
} from "lucide-react";

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

interface Award {
  id: string;
  eventId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
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

  // Awards management state
  const [awards, setAwards] = useState<Award[]>([]);
  const [newAwardName, setNewAwardName] = useState<string>("");
  const [editingAward, setEditingAward] = useState<Award | null>(null);
  const [editAwardName, setEditAwardName] = useState<string>("");
  const [awardsLoading, setAwardsLoading] = useState(false);

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

  // Helper function to convert UTC to PDT for datetime-local input
  const convertUTCtoPDTForInput = (utcString: string | null): string => {
    if (!utcString) return "";

    try {
      // Create date from UTC string
      const utcDate = new Date(utcString);

      // Check if date is valid
      if (isNaN(utcDate.getTime())) {
        console.error("Invalid date string:", utcString);
        return "";
      }

      // Convert to PDT/PST timezone using toLocaleString with proper formatting
      const pdtDateTimeString = utcDate.toLocaleString("sv-SE", {
        timeZone: timezone,
      });

      // sv-SE locale gives us YYYY-MM-DD HH:mm:ss format
      // Convert to YYYY-MM-DDTHH:mm format for datetime-local input
      const [datePart, timePart] = pdtDateTimeString.split(" ");
      const [hour, minute] = timePart.split(":");

      return `${datePart}T${hour}:${minute}`;
    } catch (error) {
      console.error("Error converting UTC to PDT:", error);
      return "";
    }
  };

  // Helper function to convert PDT datetime-local input to UTC
  const convertPDTInputToUTC = (pdtInputString: string): string => {
    if (!pdtInputString) return "";

    try {
      // Parse the input date/time parts
      const [datePart, timePart] = pdtInputString.split("T");
      const [year, month, day] = datePart.split("-");
      const [hour, minute] = timePart.split(":");

      // Create a date object representing this time in PDT/PST
      // We'll use a trick with two dates to calculate the timezone offset
      const inputDateTime = `${year}-${month}-${day} ${hour}:${minute}:00`;

      // Create a date in UTC with these same numbers
      const utcVersion = new Date(
        `${year}-${month}-${day}T${hour}:${minute}:00Z`,
      );

      // Create a date in the local timezone with these same numbers
      const localVersion = new Date(
        `${year}-${month}-${day}T${hour}:${minute}:00`,
      );

      // Find out what time it would be in PDT if we had this UTC time
      const whatWouldBeInPDT = new Date(
        utcVersion.toLocaleString("en-US", { timeZone: timezone }),
      );

      // Find out what time it would be in UTC if we had this PDT time
      const whatWouldBeInUTC = new Date(
        localVersion.toLocaleString("en-US", { timeZone: "UTC" }),
      );

      // Calculate the difference and adjust
      const offset = whatWouldBeInPDT.getTime() - utcVersion.getTime();
      const adjustedUTC = new Date(localVersion.getTime() + offset);

      return adjustedUTC.toISOString();
    } catch (error) {
      console.error("Error converting PDT to UTC:", error);
      return "";
    }
  };

  // Update selected event when selection changes
  useEffect(() => {
    const event = events.find((e) => e.id === selectedEventId);
    setSelectedEvent(event || null);
    if (event) {
      setHackathonState(event.hackathonState || "before_start");
      // Convert UTC to PDT for display in datetime-local inputs
      const convertedHackUntil = convertUTCtoPDTForInput(event.hackUntil);
      const convertedVoteUntil = convertUTCtoPDTForInput(event.voteUntil);

      console.log("Converting dates for display:");
      console.log("Original hackUntil (UTC):", event.hackUntil);
      console.log("Converted hackUntil (PDT):", convertedHackUntil);
      console.log("Original voteUntil (UTC):", event.voteUntil);
      console.log("Converted voteUntil (PDT):", convertedVoteUntil);

      setHackUntil(convertedHackUntil);
      setVoteUntil(convertedVoteUntil);
      // Fetch awards for the selected event
      fetchAwards(event.id);
    } else {
      setHackathonState("");
      setHackUntil("");
      setVoteUntil("");
      setAwards([]);
    }
  }, [selectedEventId, events, timezone]);

  // Fetch awards for a specific event
  const fetchAwards = async (eventId: string) => {
    try {
      const response = await fetch(`/api/v1/admin/awards?eventId=${eventId}`);
      if (response.ok) {
        const data = await response.json();
        setAwards(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch awards:", err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId || !hackathonState) return;

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const convertedHackUntil = hackUntil
        ? convertPDTInputToUTC(hackUntil)
        : null;
      const convertedVoteUntil = voteUntil
        ? convertPDTInputToUTC(voteUntil)
        : null;

      console.log("Converting dates for submission:");
      console.log("Input hackUntil (PDT):", hackUntil);
      console.log("Converted hackUntil (UTC):", convertedHackUntil);
      console.log("Input voteUntil (PDT):", voteUntil);
      console.log("Converted voteUntil (UTC):", convertedVoteUntil);

      const body: any = {
        eventId: selectedEventId,
        hackathonState,
        // Always send time fields, even if empty (as null)
        hackUntil: convertedHackUntil,
        voteUntil: convertedVoteUntil,
      };

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

  // Awards management functions
  const handleCreateAward = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId || !newAwardName.trim()) return;

    setAwardsLoading(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/v1/admin/awards", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventId: selectedEventId,
          name: newAwardName.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create award");
      }

      setSuccess("Award created successfully!");
      setNewAwardName("");
      await fetchAwards(selectedEventId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create award");
    } finally {
      setAwardsLoading(false);
    }
  };

  const handleUpdateAward = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAward || !editAwardName.trim()) return;

    setAwardsLoading(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(`/api/v1/admin/awards/${editingAward.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: editAwardName.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update award");
      }

      setSuccess("Award updated successfully!");
      setEditingAward(null);
      setEditAwardName("");
      await fetchAwards(selectedEventId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update award");
    } finally {
      setAwardsLoading(false);
    }
  };

  const handleDeleteAward = async (awardId: string, awardName: string) => {
    if (!confirm(`Are you sure you want to delete the award "${awardName}"?`)) {
      return;
    }

    setAwardsLoading(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(`/api/v1/admin/awards/${awardId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete award");
      }

      setSuccess("Award deleted successfully!");
      await fetchAwards(selectedEventId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete award");
    } finally {
      setAwardsLoading(false);
    }
  };

  const startEditingAward = (award: Award) => {
    setEditingAward(award);
    setEditAwardName(award.name);
  };

  const cancelEditingAward = () => {
    setEditingAward(null);
    setEditAwardName("");
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
                    <Label htmlFor="hack-until">Hack Until</Label>
                    <Input
                      id="hack-until"
                      type="datetime-local"
                      value={hackUntil}
                      onChange={(e) => setHackUntil(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      All times are displayed and entered in Pacific Daylight
                      Time (PDT)
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="vote-until">Vote Until</Label>
                    <Input
                      id="vote-until"
                      type="datetime-local"
                      value={voteUntil}
                      onChange={(e) => setVoteUntil(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      All times are displayed and entered in Pacific Daylight
                      Time (PDT)
                    </p>
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

      {/* Awards Management */}
      {selectedEvent && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Awards Management
            </CardTitle>
            <CardDescription>
              Create, edit, and manage awards for {selectedEvent.name}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Create New Award */}
            <div className="border rounded-lg p-4">
              <h4 className="font-medium mb-3">Create New Award</h4>
              <form onSubmit={handleCreateAward} className="flex gap-2">
                <Input
                  placeholder="Award name (e.g., Best Innovation, People's Choice)"
                  value={newAwardName}
                  onChange={(e) => setNewAwardName(e.target.value)}
                  disabled={awardsLoading}
                  maxLength={100}
                />
                <Button
                  type="submit"
                  disabled={awardsLoading || !newAwardName.trim()}
                  size="sm"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {awardsLoading ? "Creating..." : "Create"}
                </Button>
              </form>
            </div>

            {/* Existing Awards */}
            <div>
              <h4 className="font-medium mb-3">
                Existing Awards ({awards.length})
              </h4>
              {awards.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Trophy className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No awards created yet</p>
                  <p className="text-sm">Create your first award above</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {awards.map((award) => (
                    <div
                      key={award.id}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50"
                    >
                      {editingAward?.id === award.id ? (
                        <form
                          onSubmit={handleUpdateAward}
                          className="flex gap-2 flex-1"
                        >
                          <Input
                            value={editAwardName}
                            onChange={(e) => setEditAwardName(e.target.value)}
                            disabled={awardsLoading}
                            maxLength={100}
                            autoFocus
                          />
                          <Button
                            type="submit"
                            size="sm"
                            disabled={awardsLoading || !editAwardName.trim()}
                          >
                            Save
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={cancelEditingAward}
                            disabled={awardsLoading}
                          >
                            Cancel
                          </Button>
                        </form>
                      ) : (
                        <>
                          <div className="flex items-center gap-3">
                            <Trophy className="h-4 w-4 text-yellow-600" />
                            <div>
                              <p className="font-medium">{award.name}</p>
                              <p className="text-xs text-muted-foreground">
                                Created{" "}
                                {new Date(award.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => startEditingAward(award)}
                              disabled={awardsLoading}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleDeleteAward(award.id, award.name)
                              }
                              disabled={awardsLoading}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

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
