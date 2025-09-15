"use client";

import { useState, useRef, useEffect } from "react";
import { EventImageCard } from "@/components/admin/event-image-card";

type Event = {
  id: string;
  name: string;
  slug: string;
  startDate: Date;
  endDate: Date;
  isDraft: boolean;
};

type EventImage = {
  imageId: string;
  imageUrl: string;
  imageAlt: string;
  imageWidth: number | null;
  imageHeight: number | null;
  imagePlaceholder: string | null;
};

interface UploadImagesFormProps {
  events: Event[];
}

export default function UploadImagesForm({ events }: UploadImagesFormProps) {
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [existingImages, setExistingImages] = useState<EventImage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing images when event is selected
  useEffect(() => {
    if (selectedEventId) {
      loadExistingImages(selectedEventId);
    } else {
      setExistingImages([]);
    }
  }, [selectedEventId]);

  const loadExistingImages = async (eventId: string) => {
    setIsLoadingImages(true);
    try {
      const response = await fetch(`/api/v1/admin/event-images/${eventId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch existing images");
      }
      const data = await response.json();
      setExistingImages(data.images || []);
    } catch (error) {
      console.error("Error loading existing images:", error);
      setExistingImages([]);
    } finally {
      setIsLoadingImages(false);
    }
  };

  const handleDeleteImage = async (imageId: string, imageUrl: string) => {
    setMessage(null);

    try {
      const response = await fetch("/api/v1/admin/delete-event-image", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ imageId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete image");
      }

      setMessage({
        type: "success",
        text: "Image deleted successfully!",
      });

      // Reload existing images to reflect the deletion
      if (selectedEventId) {
        await loadExistingImages(selectedEventId);
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to delete image",
      });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles(files);
    setMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedEventId) {
      setMessage({
        type: "error",
        text: "Please select an event.",
      });
      return;
    }

    if (selectedFiles.length === 0) {
      setMessage({
        type: "error",
        text: "Please select at least one image file.",
      });
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append("eventId", selectedEventId);

      // Append all selected files
      selectedFiles.forEach((file) => {
        formData.append("images", file);
      });

      const response = await fetch("/api/v1/admin/upload-event-images", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to upload images");
      }

      const result = await response.json();
      setMessage({
        type: "success",
        text: `Successfully uploaded ${result.uploadedCount} image(s) to the event!`,
      });

      // Reset form
      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      // Reload existing images to show the newly uploaded ones
      await loadExistingImages(selectedEventId);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "An error occurred",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const removeFile = (index: number) => {
    const newFiles = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(newFiles);

    // Update the file input
    if (fileInputRef.current && newFiles.length === 0) {
      fileInputRef.current.value = "";
    }
  };

  const selectedEvent = events.find((event) => event.id === selectedEventId);

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
        {/* Event Selection */}
        <div>
          <label
            htmlFor="event"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Select Event
          </label>
          <select
            id="event"
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
          >
            <option value="">Choose an event...</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name} ({event.slug}){event.isDraft && " - DRAFT"}
              </option>
            ))}
          </select>
        </div>

        {/* Selected Event Display */}
        {selectedEvent && (
          <div className="bg-gray-50 p-4 rounded-md">
            <h3 className="text-sm font-medium text-gray-700 mb-2">
              Selected Event
            </h3>
            <div className="text-sm text-gray-600">
              <p>
                <strong>Name:</strong> {selectedEvent.name}
              </p>
              <p>
                <strong>Slug:</strong> {selectedEvent.slug}
              </p>
              <p>
                <strong>Date:</strong>{" "}
                {new Date(selectedEvent.startDate).toLocaleDateString()}
                {selectedEvent.isDraft && (
                  <span className="ml-2 px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded">
                    DRAFT
                  </span>
                )}
              </p>
            </div>
          </div>
        )}

        {/* File Selection */}
        <div>
          <label
            htmlFor="images"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Select Images
          </label>
          <input
            ref={fileInputRef}
            type="file"
            id="images"
            multiple
            accept="image/*"
            onChange={handleFileChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            required
          />
          <p className="text-sm text-gray-500 mt-1">
            Select multiple image files to upload to the event
          </p>
        </div>

        {/* Existing Images Display */}
        {selectedEventId && (
          <div className="bg-blue-50 p-4 rounded-md border border-blue-200">
            <h3 className="text-sm font-medium text-blue-900 mb-3">
              Existing Images ({existingImages.length})
            </h3>
            {isLoadingImages ? (
              <p className="text-sm text-blue-600">
                Loading existing images...
              </p>
            ) : existingImages.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {existingImages.map((image) => (
                  <EventImageCard
                    key={image.imageId}
                    image={image}
                    showDelete={true}
                    onDelete={async (imageId) => {
                      await handleDeleteImage(imageId, image.imageUrl);
                    }}
                    imageContainerClassName="aspect-square"
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-blue-600">
                No images found for this event. Upload some images below!
              </p>
            )}
          </div>
        )}

        {/* Selected Files Display */}
        {selectedFiles.length > 0 && (
          <div className="bg-gray-50 p-4 rounded-md">
            <h3 className="text-sm font-medium text-gray-700 mb-2">
              Selected Files ({selectedFiles.length})
            </h3>
            <div className="space-y-2">
              {selectedFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between bg-white p-2 rounded border"
                >
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">{file.name}</span>
                    <span className="ml-2 text-gray-400">
                      ({(file.size / 1024 / 1024).toFixed(2)} MB)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upload Button */}
        <div>
          <button
            type="submit"
            disabled={
              isLoading || !selectedEventId || selectedFiles.length === 0
            }
            className="w-full inline-flex justify-center py-3 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <div className="flex items-center">
                <svg
                  className="animate-spin -ml-1 mr-3 h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                Uploading Images...
              </div>
            ) : (
              `Upload ${selectedFiles.length} Image${selectedFiles.length !== 1 ? "s" : ""}`
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
