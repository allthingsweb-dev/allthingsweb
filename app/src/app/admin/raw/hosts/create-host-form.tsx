"use client";

import { useEffect, useState } from "react";
import { ImageUploadCrop } from "@/components/image-upload-crop";

type EditableHost = {
  id: string;
  name: string;
  about: string;
  squareLogoDark: string | null;
  squareLogoLight: string | null;
  squareLogoDarkUrl: string | null;
  squareLogoLightUrl: string | null;
};

interface CreateHostFormProps {
  initialHosts: EditableHost[];
}

export default function CreateHostForm({ initialHosts }: CreateHostFormProps) {
  const [hosts, setHosts] = useState(initialHosts);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [darkLogoFile, setDarkLogoFile] = useState<File | null>(null);
  const [lightLogoFile, setLightLogoFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [selectedHostId, setSelectedHostId] = useState("");
  const [editName, setEditName] = useState("");
  const [editAbout, setEditAbout] = useState("");
  const [editDarkLogoFile, setEditDarkLogoFile] = useState<File | null>(null);
  const [editLightLogoFile, setEditLightLogoFile] = useState<File | null>(null);
  const [editDarkLogoUrl, setEditDarkLogoUrl] = useState<string | null>(null);
  const [editLightLogoUrl, setEditLightLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedHostId) return;
    const host = hosts.find((entry) => entry.id === selectedHostId);
    if (!host) return;
    setEditName(host.name);
    setEditAbout(host.about);
    setEditDarkLogoUrl(host.squareLogoDarkUrl);
    setEditLightLogoUrl(host.squareLogoLightUrl);
    setEditDarkLogoFile(null);
    setEditLightLogoFile(null);
  }, [selectedHostId, hosts]);

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

      const response = await fetch("/api/v1/admin/raw/hosts", {
        method: "POST",
        body: payload,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to create host");
      }

      setHosts((prev) => [
        ...prev,
        {
          ...data.host,
          squareLogoDark: data.host.squareLogoDark ?? null,
          squareLogoLight: data.host.squareLogoLight ?? null,
          squareLogoDarkUrl: data.host.squareLogoDarkUrl ?? null,
          squareLogoLightUrl: data.host.squareLogoLightUrl ?? null,
        },
      ]);
      setMessage({
        type: "success",
        text: `Host created: ${data.host.name} (${data.host.id})`,
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
      if (!selectedHostId) {
        throw new Error("Please select a host to edit");
      }

      const payload = new FormData();
      payload.append("hostId", selectedHostId);
      payload.append("name", editName);
      payload.append("about", editAbout);
      if (editDarkLogoFile) {
        payload.append("darkLogo", editDarkLogoFile);
      }
      if (editLightLogoFile) {
        payload.append("lightLogo", editLightLogoFile);
      }

      const response = await fetch("/api/v1/admin/raw/hosts", {
        method: "PUT",
        body: payload,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to update host");
      }

      setHosts((prev) =>
        prev.map((host) =>
          host.id === selectedHostId
            ? {
                ...host,
                ...data.host,
                squareLogoDark: data.host.squareLogoDark ?? null,
                squareLogoLight: data.host.squareLogoLight ?? null,
                squareLogoDarkUrl: data.host.squareLogoDarkUrl ?? null,
                squareLogoLightUrl: data.host.squareLogoLightUrl ?? null,
              }
            : host,
        ),
      );
      setEditDarkLogoUrl(data.host.squareLogoDarkUrl ?? null);
      setEditLightLogoUrl(data.host.squareLogoLightUrl ?? null);
      setEditDarkLogoFile(null);
      setEditLightLogoFile(null);

      setMessage({
        type: "success",
        text: `Host updated: ${data.host.name} (${data.host.id})`,
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
        <h2 className="text-lg font-semibold text-gray-900">Create New Host</h2>
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
            Host Name
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
          {isLoading ? "Creating..." : "Create Host"}
        </button>
      </form>

      <div className="border-t border-gray-200 pt-6">
        <form onSubmit={handleUpdateSubmit} className="space-y-6">
          <h2 className="text-lg font-semibold text-gray-900">
            Edit Existing Host
          </h2>

          <div>
            <label
              htmlFor="edit-host-id"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Select Host
            </label>
            <select
              id="edit-host-id"
              value={selectedHostId}
              onChange={(e) => setSelectedHostId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Choose a host...</option>
              {hosts.map((host) => (
                <option key={host.id} value={host.id}>
                  {host.name}
                </option>
              ))}
            </select>
          </div>

          {selectedHostId && (
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
                  htmlFor="edit-host-name"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Host Name
                </label>
                <input
                  id="edit-host-name"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="edit-host-about"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  About
                </label>
                <textarea
                  id="edit-host-about"
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
                {isLoading ? "Updating..." : "Update Host"}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
