"use client";

import { useEffect, useMemo, useState } from "react";

type Profile = {
  id: string;
  name: string;
  title: string;
  profileType: "member" | "organizer";
};

interface CreateTalkFormProps {
  profiles: Profile[];
  initialTalks: {
    id: string;
    title: string;
    description: string;
    speakerIds: string[];
  }[];
}

export default function CreateTalkForm({
  profiles,
  initialTalks,
}: CreateTalkFormProps) {
  const [talks, setTalks] = useState(initialTalks);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedSpeakerIds, setSelectedSpeakerIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [selectedTalkId, setSelectedTalkId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSpeakerIds, setEditSpeakerIds] = useState<string[]>([]);

  const sortedProfiles = useMemo(
    () =>
      [...profiles].sort((a, b) => {
        if (a.profileType === b.profileType) {
          return a.name.localeCompare(b.name);
        }
        return a.profileType === "member" ? -1 : 1;
      }),
    [profiles],
  );

  const toggleSpeaker = (speakerId: string) => {
    setSelectedSpeakerIds((prev) =>
      prev.includes(speakerId)
        ? prev.filter((id) => id !== speakerId)
        : [...prev, speakerId],
    );
  };

  const toggleEditSpeaker = (speakerId: string) => {
    setEditSpeakerIds((prev) =>
      prev.includes(speakerId)
        ? prev.filter((id) => id !== speakerId)
        : [...prev, speakerId],
    );
  };

  useEffect(() => {
    if (!selectedTalkId) return;
    const selectedTalk = talks.find((talk) => talk.id === selectedTalkId);
    if (!selectedTalk) return;
    setEditTitle(selectedTalk.title);
    setEditDescription(selectedTalk.description);
    setEditSpeakerIds(selectedTalk.speakerIds);
  }, [selectedTalkId, talks]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/v1/admin/raw/talks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          description,
          speakerIds: selectedSpeakerIds,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to create talk");
      }

      setMessage({
        type: "success",
        text: `Talk created: ${data.talk.title} (${data.talk.id})`,
      });
      setTalks((prev) => [
        ...prev,
        {
          id: data.talk.id,
          title: data.talk.title,
          description: data.talk.description,
          speakerIds: data.speakerIds,
        },
      ]);
      setTitle("");
      setDescription("");
      setSelectedSpeakerIds([]);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Unexpected error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);

    try {
      if (!selectedTalkId) {
        throw new Error("Please select a talk to edit");
      }

      const response = await fetch("/api/v1/admin/raw/talks", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          talkId: selectedTalkId,
          title: editTitle,
          description: editDescription,
          speakerIds: editSpeakerIds,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to update talk");
      }

      setTalks((prev) =>
        prev.map((talk) =>
          talk.id === selectedTalkId
            ? {
                id: data.talk.id,
                title: data.talk.title,
                description: data.talk.description,
                speakerIds: data.speakerIds,
              }
            : talk,
        ),
      );
      setMessage({
        type: "success",
        text: `Talk updated: ${data.talk.title} (${data.talk.id})`,
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Unexpected error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
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
        <h2 className="text-lg font-semibold text-gray-900">Create New Talk</h2>
        <div>
          <label
            htmlFor="title"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Title
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
          />
        </div>

        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Description
          </label>
          <textarea
            id="description"
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-gray-700">
              Speakers (select at least one)
            </label>
            <span className="text-sm text-gray-500">
              {selectedSpeakerIds.length} selected
            </span>
          </div>
          <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-md">
            {sortedProfiles.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">
                No profiles available. Create profiles first.
              </p>
            ) : (
              <div className="divide-y divide-gray-200">
                {sortedProfiles.map((profile) => (
                  <label
                    key={profile.id}
                    className="flex items-start gap-3 p-3 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSpeakerIds.includes(profile.id)}
                      onChange={() => toggleSpeaker(profile.id)}
                      className="mt-1"
                    />
                    <div className="text-sm">
                      <div className="font-medium text-gray-900">
                        {profile.name}
                      </div>
                      <div className="text-gray-600">
                        {profile.title} ({profile.profileType})
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "Creating..." : "Create Talk"}
        </button>
      </form>

      <div className="border-t border-gray-200 pt-6">
        <form onSubmit={handleUpdateSubmit} className="space-y-6">
          <h2 className="text-lg font-semibold text-gray-900">
            Edit Existing Talk
          </h2>

          <div>
            <label
              htmlFor="edit-talk-id"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Select Talk
            </label>
            <select
              id="edit-talk-id"
              value={selectedTalkId}
              onChange={(e) => setSelectedTalkId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Choose a talk...</option>
              {talks.map((talk) => (
                <option key={talk.id} value={talk.id}>
                  {talk.title}
                </option>
              ))}
            </select>
          </div>

          {selectedTalkId && (
            <>
              <div>
                <label
                  htmlFor="edit-title"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Title
                </label>
                <input
                  id="edit-title"
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="edit-description"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Description
                </label>
                <textarea
                  id="edit-description"
                  rows={5}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-700">
                    Speakers
                  </label>
                  <span className="text-sm text-gray-500">
                    {editSpeakerIds.length} selected
                  </span>
                </div>
                <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-md">
                  <div className="divide-y divide-gray-200">
                    {sortedProfiles.map((profile) => (
                      <label
                        key={`edit-${profile.id}`}
                        className="flex items-start gap-3 p-3 hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={editSpeakerIds.includes(profile.id)}
                          onChange={() => toggleEditSpeaker(profile.id)}
                          className="mt-1"
                        />
                        <div className="text-sm">
                          <div className="font-medium text-gray-900">
                            {profile.name}
                          </div>
                          <div className="text-gray-600">
                            {profile.title} ({profile.profileType})
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? "Updating..." : "Update Talk"}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
