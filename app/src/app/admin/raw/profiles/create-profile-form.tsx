"use client";

import { useEffect, useState } from "react";
import { ImageUploadCrop } from "@/components/image-upload-crop";

type ProfileType = "member" | "organizer";

type EditableProfile = {
  id: string;
  name: string;
  title: string;
  bio: string;
  profileType: ProfileType;
  twitterHandle: string | null;
  blueskyHandle: string | null;
  linkedinHandle: string | null;
  imageId: string | null;
  imageUrl: string | null;
};

interface CreateProfileFormProps {
  initialProfiles: EditableProfile[];
}

export default function CreateProfileForm({
  initialProfiles,
}: CreateProfileFormProps) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [bio, setBio] = useState("");
  const [profileType, setProfileType] = useState<ProfileType>("member");
  const [twitterHandle, setTwitterHandle] = useState("");
  const [blueskyHandle, setBlueskyHandle] = useState("");
  const [linkedinHandle, setLinkedinHandle] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [editName, setEditName] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editProfileType, setEditProfileType] = useState<ProfileType>("member");
  const [editTwitterHandle, setEditTwitterHandle] = useState("");
  const [editBlueskyHandle, setEditBlueskyHandle] = useState("");
  const [editLinkedinHandle, setEditLinkedinHandle] = useState("");
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [removeEditImage, setRemoveEditImage] = useState(false);
  const [editCurrentImageUrl, setEditCurrentImageUrl] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!selectedProfileId) return;
    const selected = profiles.find(
      (profile) => profile.id === selectedProfileId,
    );
    if (!selected) return;
    setEditName(selected.name);
    setEditTitle(selected.title);
    setEditBio(selected.bio);
    setEditProfileType(selected.profileType);
    setEditTwitterHandle(selected.twitterHandle ?? "");
    setEditBlueskyHandle(selected.blueskyHandle ?? "");
    setEditLinkedinHandle(selected.linkedinHandle ?? "");
    setEditCurrentImageUrl(selected.imageUrl);
    setEditImageFile(null);
    setRemoveEditImage(false);
  }, [profiles, selectedProfileId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);

    try {
      const payload = new FormData();
      payload.append("name", name);
      payload.append("title", title);
      payload.append("bio", bio);
      payload.append("profileType", profileType);

      if (twitterHandle.trim()) {
        payload.append("twitterHandle", twitterHandle.trim());
      }
      if (blueskyHandle.trim()) {
        payload.append("blueskyHandle", blueskyHandle.trim());
      }
      if (linkedinHandle.trim()) {
        payload.append("linkedinHandle", linkedinHandle.trim());
      }
      if (imageFile) {
        payload.append("image", imageFile);
      }

      const response = await fetch("/api/v1/admin/raw/profiles", {
        method: "POST",
        body: payload,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to create profile");
      }

      setProfiles((prev) => [
        ...prev,
        {
          ...data.profile,
          imageId: data.profile.image ?? null,
          imageUrl: data.profile.imageUrl ?? null,
          twitterHandle: data.profile.twitterHandle ?? null,
          blueskyHandle: data.profile.blueskyHandle ?? null,
          linkedinHandle: data.profile.linkedinHandle ?? null,
        },
      ]);

      setMessage({
        type: "success",
        text: `Profile created: ${data.profile.name} (${data.profile.id})`,
      });

      setName("");
      setTitle("");
      setBio("");
      setProfileType("member");
      setTwitterHandle("");
      setBlueskyHandle("");
      setLinkedinHandle("");
      setImageFile(null);
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
      if (!selectedProfileId) {
        throw new Error("Please select a profile to edit");
      }

      const payload = new FormData();
      payload.append("profileId", selectedProfileId);
      payload.append("name", editName);
      payload.append("title", editTitle);
      payload.append("bio", editBio);
      payload.append("profileType", editProfileType);
      payload.append("removeImage", removeEditImage ? "true" : "false");

      if (editTwitterHandle.trim()) {
        payload.append("twitterHandle", editTwitterHandle.trim());
      }
      if (editBlueskyHandle.trim()) {
        payload.append("blueskyHandle", editBlueskyHandle.trim());
      }
      if (editLinkedinHandle.trim()) {
        payload.append("linkedinHandle", editLinkedinHandle.trim());
      }
      if (editImageFile) {
        payload.append("image", editImageFile);
      }

      const response = await fetch("/api/v1/admin/raw/profiles", {
        method: "PUT",
        body: payload,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to update profile");
      }

      setProfiles((prev) =>
        prev.map((profile) =>
          profile.id === selectedProfileId
            ? {
                ...profile,
                ...data.profile,
                imageId: data.profile.image ?? null,
                imageUrl: data.profile.imageUrl ?? null,
                twitterHandle: data.profile.twitterHandle ?? null,
                blueskyHandle: data.profile.blueskyHandle ?? null,
                linkedinHandle: data.profile.linkedinHandle ?? null,
              }
            : profile,
        ),
      );

      setEditCurrentImageUrl(data.profile.imageUrl ?? null);
      setEditImageFile(null);
      setRemoveEditImage(false);
      setMessage({
        type: "success",
        text: `Profile updated: ${data.profile.name} (${data.profile.id})`,
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
        <h2 className="text-lg font-semibold text-gray-900">
          Create New Profile
        </h2>
        <ImageUploadCrop
          onImageCropped={(file) => setImageFile(file)}
          onImageRemoved={() => setImageFile(null)}
          label="Profile Image (Optional)"
          aspectRatio={1}
          maxWidth={1200}
          maxHeight={1200}
        />

        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
          />
        </div>

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
            htmlFor="profileType"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Profile Type
          </label>
          <select
            id="profileType"
            value={profileType}
            onChange={(e) => setProfileType(e.target.value as ProfileType)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
          >
            <option value="member">member</option>
            <option value="organizer">organizer</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="bio"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Bio
          </label>
          <textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={5}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label
              htmlFor="twitterHandle"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Twitter Handle
            </label>
            <input
              id="twitterHandle"
              type="text"
              value={twitterHandle}
              onChange={(e) => setTwitterHandle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="leerob"
            />
          </div>
          <div>
            <label
              htmlFor="blueskyHandle"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Bluesky Handle
            </label>
            <input
              id="blueskyHandle"
              type="text"
              value={blueskyHandle}
              onChange={(e) => setBlueskyHandle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="leerob.bsky.social"
            />
          </div>
          <div>
            <label
              htmlFor="linkedinHandle"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              LinkedIn Handle
            </label>
            <input
              id="linkedinHandle"
              type="text"
              value={linkedinHandle}
              onChange={(e) => setLinkedinHandle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="leeerob"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "Creating..." : "Create Profile"}
        </button>
      </form>

      <div className="border-t border-gray-200 pt-6">
        <form onSubmit={handleUpdateSubmit} className="space-y-6">
          <h2 className="text-lg font-semibold text-gray-900">
            Edit Existing Profile
          </h2>

          <div>
            <label
              htmlFor="edit-profile-id"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Select Profile
            </label>
            <select
              id="edit-profile-id"
              value={selectedProfileId}
              onChange={(e) => setSelectedProfileId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Choose a profile...</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} ({profile.profileType})
                </option>
              ))}
            </select>
          </div>

          {selectedProfileId && (
            <>
              <ImageUploadCrop
                onImageCropped={(file) => {
                  setEditImageFile(file);
                  setRemoveEditImage(false);
                }}
                onImageRemoved={() => {
                  setEditImageFile(null);
                  setRemoveEditImage(true);
                  setEditCurrentImageUrl(null);
                }}
                currentImageUrl={editCurrentImageUrl ?? undefined}
                label="Profile Image"
                aspectRatio={1}
                maxWidth={1200}
                maxHeight={1200}
              />

              <div className="flex items-center gap-2">
                <input
                  id="remove-image"
                  type="checkbox"
                  checked={removeEditImage}
                  onChange={(e) => setRemoveEditImage(e.target.checked)}
                />
                <label htmlFor="remove-image" className="text-sm text-gray-700">
                  Remove current profile image
                </label>
              </div>

              <div>
                <label
                  htmlFor="edit-name"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Name
                </label>
                <input
                  id="edit-name"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

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
                  htmlFor="edit-profile-type"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Profile Type
                </label>
                <select
                  id="edit-profile-type"
                  value={editProfileType}
                  onChange={(e) =>
                    setEditProfileType(e.target.value as ProfileType)
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="member">member</option>
                  <option value="organizer">organizer</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="edit-bio"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Bio
                </label>
                <textarea
                  id="edit-bio"
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  rows={5}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label
                    htmlFor="edit-twitter-handle"
                    className="block text-sm font-medium text-gray-700 mb-2"
                  >
                    Twitter Handle
                  </label>
                  <input
                    id="edit-twitter-handle"
                    type="text"
                    value={editTwitterHandle}
                    onChange={(e) => setEditTwitterHandle(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="edit-bluesky-handle"
                    className="block text-sm font-medium text-gray-700 mb-2"
                  >
                    Bluesky Handle
                  </label>
                  <input
                    id="edit-bluesky-handle"
                    type="text"
                    value={editBlueskyHandle}
                    onChange={(e) => setEditBlueskyHandle(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="edit-linkedin-handle"
                    className="block text-sm font-medium text-gray-700 mb-2"
                  >
                    LinkedIn Handle
                  </label>
                  <input
                    id="edit-linkedin-handle"
                    type="text"
                    value={editLinkedinHandle}
                    onChange={(e) => setEditLinkedinHandle(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? "Updating..." : "Update Profile"}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
