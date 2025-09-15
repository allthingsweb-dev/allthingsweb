"use client";

import { useState, useEffect } from "react";

type Profile = {
  id: string;
  name: string;
  title: string;
  profileType: "organizer" | "member";
};

type User = {
  id: string;
  name: string | null;
  email: string | null;
};

type ProfileWithUser = {
  profile: Profile;
  user: User | null;
} | null;

interface AssignProfileFormProps {
  profiles: Profile[];
  users: User[];
}

export default function AssignProfileForm({
  profiles,
  users,
}: AssignProfileFormProps) {
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [currentAssignment, setCurrentAssignment] =
    useState<ProfileWithUser>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Load current assignment when profile is selected
  useEffect(() => {
    if (selectedProfileId) {
      loadCurrentAssignment(selectedProfileId);
    } else {
      setCurrentAssignment(null);
      setSelectedUserId("");
    }
  }, [selectedProfileId]);

  const loadCurrentAssignment = async (profileId: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/v1/admin/profile-assignment/${profileId}`,
      );
      if (!response.ok) {
        throw new Error("Failed to fetch assignment");
      }
      const data = await response.json();
      setCurrentAssignment(data.profileWithUser);
      if (data.profileWithUser?.user) {
        setSelectedUserId(data.profileWithUser.user.id);
      } else {
        setSelectedUserId("");
      }
    } catch (error) {
      console.error("Error loading assignment:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedProfileId || !selectedUserId) {
      setMessage({
        type: "error",
        text: "Please select both a profile and a user.",
      });
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/v1/admin/assign-profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profileId: selectedProfileId,
          userId: selectedUserId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to assign profile");
      }

      setMessage({ type: "success", text: "Profile assigned successfully!" });

      // Reload the current assignment to show updated data
      await loadCurrentAssignment(selectedProfileId);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "An error occurred",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveAssignment = async () => {
    if (!selectedProfileId) return;

    setIsLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/v1/admin/assign-profile", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profileId: selectedProfileId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to remove assignment");
      }

      setMessage({ type: "success", text: "Assignment removed successfully!" });
      setSelectedUserId("");

      // Reload the current assignment
      await loadCurrentAssignment(selectedProfileId);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "An error occurred",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
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

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Profile Selection */}
        <div>
          <label
            htmlFor="profile"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Select Profile
          </label>
          <select
            id="profile"
            value={selectedProfileId}
            onChange={(e) => setSelectedProfileId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
          >
            <option value="">Choose a profile...</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} - {profile.title} ({profile.profileType})
              </option>
            ))}
          </select>
        </div>

        {/* Current Assignment Display */}
        {selectedProfileId && (
          <div className="bg-gray-50 p-4 rounded-md">
            <h3 className="text-sm font-medium text-gray-700 mb-2">
              Current Assignment
            </h3>
            {isLoading ? (
              <p className="text-sm text-gray-500">Loading...</p>
            ) : currentAssignment?.user ? (
              <div className="text-sm text-gray-600">
                <p>
                  <strong>Assigned to:</strong>{" "}
                  {currentAssignment.user.name || "No name"}
                </p>
                <p>
                  <strong>Email:</strong> {currentAssignment.user.email}
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                No user currently assigned
              </p>
            )}
          </div>
        )}

        {/* User Selection */}
        {selectedProfileId && (
          <div>
            <label
              htmlFor="user"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              {currentAssignment?.user
                ? "Change Assignment to User"
                : "Assign to User"}
            </label>
            <select
              id="user"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required
            >
              <option value="">Choose a user...</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name || "No name"} - {user.email}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Action Buttons */}
        {selectedProfileId && (
          <div className="flex space-x-3">
            <button
              type="submit"
              disabled={isLoading || !selectedUserId}
              className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading
                ? "Processing..."
                : currentAssignment?.user
                  ? "Update Assignment"
                  : "Assign Profile"}
            </button>

            {currentAssignment?.user && (
              <button
                type="button"
                onClick={handleRemoveAssignment}
                disabled={isLoading}
                className="inline-flex justify-center py-2 px-4 border border-red-300 shadow-sm text-sm font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? "Processing..." : "Remove Assignment"}
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
