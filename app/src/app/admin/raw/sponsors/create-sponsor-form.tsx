"use client";

import { useEffect, useState } from "react";
import { ImageUploadCrop } from "@/components/image-upload-crop";

type EditableSponsor = {
  id: string;
  name: string;
  about: string;
  squareLogoDark: string | null;
  squareLogoLight: string | null;
  squareLogoDarkUrl: string | null;
  squareLogoLightUrl: string | null;
};

interface CreateSponsorFormProps {
  initialSponsors: EditableSponsor[];
}

export default function CreateSponsorForm({
  initialSponsors,
}: CreateSponsorFormProps) {
  const [sponsors, setSponsors] = useState(initialSponsors);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [darkLogoFile, setDarkLogoFile] = useState<File | null>(null);
  const [lightLogoFile, setLightLogoFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [selectedSponsorId, setSelectedSponsorId] = useState("");
  const [editName, setEditName] = useState("");
  const [editAbout, setEditAbout] = useState("");
  const [editDarkLogoFile, setEditDarkLogoFile] = useState<File | null>(null);
  const [editLightLogoFile, setEditLightLogoFile] = useState<File | null>(null);
  const [editDarkLogoUrl, setEditDarkLogoUrl] = useState<string | null>(null);
  const [editLightLogoUrl, setEditLightLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedSponsorId) return;
    const sponsor = sponsors.find((entry) => entry.id === selectedSponsorId);
    if (!sponsor) return;
    setEditName(sponsor.name);
    setEditAbout(sponsor.about);
    setEditDarkLogoUrl(sponsor.squareLogoDarkUrl);
    setEditLightLogoUrl(sponsor.squareLogoLightUrl);
    setEditDarkLogoFile(null);
    setEditLightLogoFile(null);
  }, [selectedSponsorId, sponsors]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage(null);

    try {
      if (!darkLogoFile || !lightLogoFile) {
        throw new Error("Both dark and light logos are required");
      }

      const payload = new FormData();
      payload.append("name", name);
      payload.append("about", about);
      payload.append("darkLogo", darkLogoFile);
      payload.append("lightLogo", lightLogoFile);

      const response = await fetch("/api/v1/admin/raw/sponsors", {
        method: "POST",
        body: payload,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to create sponsor");
      }

      setSponsors((prev) => [
        ...prev,
        {
          ...data.sponsor,
          squareLogoDark: data.sponsor.squareLogoDark ?? null,
          squareLogoLight: data.sponsor.squareLogoLight ?? null,
          squareLogoDarkUrl: data.sponsor.squareLogoDarkUrl ?? null,
          squareLogoLightUrl: data.sponsor.squareLogoLightUrl ?? null,
        },
      ]);
      setMessage({
        type: "success",
        text: `Sponsor created: ${data.sponsor.name} (${data.sponsor.id})`,
      });

      setName("");
      setAbout("");
      setDarkLogoFile(null);
      setLightLogoFile(null);
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
      if (!selectedSponsorId) {
        throw new Error("Please select a sponsor to edit");
      }

      const payload = new FormData();
      payload.append("sponsorId", selectedSponsorId);
      payload.append("name", editName);
      payload.append("about", editAbout);
      if (editDarkLogoFile) {
        payload.append("darkLogo", editDarkLogoFile);
      }
      if (editLightLogoFile) {
        payload.append("lightLogo", editLightLogoFile);
      }

      const response = await fetch("/api/v1/admin/raw/sponsors", {
        method: "PUT",
        body: payload,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to update sponsor");
      }

      setSponsors((prev) =>
        prev.map((sponsor) =>
          sponsor.id === selectedSponsorId
            ? {
                ...sponsor,
                ...data.sponsor,
                squareLogoDark: data.sponsor.squareLogoDark ?? null,
                squareLogoLight: data.sponsor.squareLogoLight ?? null,
                squareLogoDarkUrl: data.sponsor.squareLogoDarkUrl ?? null,
                squareLogoLightUrl: data.sponsor.squareLogoLightUrl ?? null,
              }
            : sponsor,
        ),
      );
      setEditDarkLogoUrl(data.sponsor.squareLogoDarkUrl ?? null);
      setEditLightLogoUrl(data.sponsor.squareLogoLightUrl ?? null);
      setEditDarkLogoFile(null);
      setEditLightLogoFile(null);

      setMessage({
        type: "success",
        text: `Sponsor updated: ${data.sponsor.name} (${data.sponsor.id})`,
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
          Create New Sponsor
        </h2>
        <div className="grid gap-6 md:grid-cols-2">
          <ImageUploadCrop
            onImageCropped={(file) => setDarkLogoFile(file)}
            onImageRemoved={() => setDarkLogoFile(null)}
            label="Dark Logo (Required)"
            aspectRatio={1}
            maxWidth={1200}
            maxHeight={1200}
          />
          <ImageUploadCrop
            onImageCropped={(file) => setLightLogoFile(file)}
            onImageRemoved={() => setLightLogoFile(null)}
            label="Light Logo (Required)"
            aspectRatio={1}
            maxWidth={1200}
            maxHeight={1200}
          />
        </div>

        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Sponsor Name
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
            htmlFor="about"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            About
          </label>
          <textarea
            id="about"
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "Creating..." : "Create Sponsor"}
        </button>
      </form>

      <div className="border-t border-gray-200 pt-6">
        <form onSubmit={handleUpdateSubmit} className="space-y-6">
          <h2 className="text-lg font-semibold text-gray-900">
            Edit Existing Sponsor
          </h2>

          <div>
            <label
              htmlFor="edit-sponsor-id"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Select Sponsor
            </label>
            <select
              id="edit-sponsor-id"
              value={selectedSponsorId}
              onChange={(e) => setSelectedSponsorId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Choose a sponsor...</option>
              {sponsors.map((sponsor) => (
                <option key={sponsor.id} value={sponsor.id}>
                  {sponsor.name}
                </option>
              ))}
            </select>
          </div>

          {selectedSponsorId && (
            <>
              <div className="grid gap-6 md:grid-cols-2">
                <ImageUploadCrop
                  onImageCropped={(file) => setEditDarkLogoFile(file)}
                  onImageRemoved={() => setEditDarkLogoFile(null)}
                  currentImageUrl={editDarkLogoUrl ?? undefined}
                  label="Dark Logo"
                  aspectRatio={1}
                  maxWidth={1200}
                  maxHeight={1200}
                />
                <ImageUploadCrop
                  onImageCropped={(file) => setEditLightLogoFile(file)}
                  onImageRemoved={() => setEditLightLogoFile(null)}
                  currentImageUrl={editLightLogoUrl ?? undefined}
                  label="Light Logo"
                  aspectRatio={1}
                  maxWidth={1200}
                  maxHeight={1200}
                />
              </div>

              <div>
                <label
                  htmlFor="edit-sponsor-name"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Sponsor Name
                </label>
                <input
                  id="edit-sponsor-name"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="edit-sponsor-about"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  About
                </label>
                <textarea
                  id="edit-sponsor-about"
                  value={editAbout}
                  onChange={(e) => setEditAbout(e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? "Updating..." : "Update Sponsor"}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
