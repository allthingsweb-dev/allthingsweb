"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/admin/copy-button";

type EventImage = {
  imageId: string;
  imageUrl: string;
  imageAlt: string;
  imageWidth: number | null;
  imageHeight: number | null;
  imagePlaceholder: string | null;
};

interface EventImageCardProps {
  image: EventImage;
  showDelete?: boolean;
  onDelete?: (imageId: string) => Promise<void>;
  className?: string;
  imageContainerClassName?: string;
}

export function EventImageCard({
  image,
  showDelete = false,
  onDelete,
  className = "",
  imageContainerClassName = "h-48",
}: EventImageCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!onDelete) return;

    if (
      !confirm(
        "Are you sure you want to delete this image? This action cannot be undone.",
      )
    ) {
      return;
    }

    setIsDeleting(true);
    try {
      await onDelete(image.imageId);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Image Preview */}
      <div className="relative group">
        <div
          className={`bg-white rounded-lg overflow-hidden border shadow-sm ${imageContainerClassName}`}
        >
          <img
            src={image.imageUrl}
            alt={image.imageAlt}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => {
              // Fallback to a gray placeholder if image fails to load
              e.currentTarget.src =
                "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjQwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+CiAgPHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNiIgZmlsbD0iIzlmYTZiMiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlIG5vdCBmb3VuZDwvdGV4dD4KICA8L3N2Zz4=";
            }}
          />
        </div>

        {/* Delete Button */}
        {showDelete && onDelete && (
          <Button
            variant="destructive"
            size="sm"
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-2 h-auto"
            onClick={handleDelete}
            disabled={isDeleting}
            title="Delete image"
          >
            {isDeleting ? (
              <svg
                className="animate-spin h-3 w-3"
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
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
          </Button>
        )}
      </div>

      {/* Image Details */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500">Image ID</span>
          <CopyButton
            text={image.imageId}
            className="text-xs text-gray-600 hover:text-gray-900"
          >
            <span className="font-mono">{image.imageId.slice(0, 8)}...</span>
          </CopyButton>
        </div>

        {image.imageWidth && image.imageHeight && (
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">
              Dimensions
            </span>
            <span className="text-xs text-gray-600">
              {image.imageWidth} × {image.imageHeight}
            </span>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-500">URL</span>
            <CopyButton
              text={image.imageUrl}
              className="text-xs text-gray-600 hover:text-gray-900"
              title="Copy URL to clipboard"
            />
          </div>
          <div className="text-xs text-gray-600 break-all font-mono bg-gray-50 p-2 rounded border">
            {image.imageUrl.length > 60
              ? `${image.imageUrl.slice(0, 30)}...${image.imageUrl.slice(-30)}`
              : image.imageUrl}
          </div>
        </div>

        {image.imageAlt && (
          <div>
            <span className="text-xs font-medium text-gray-500">Alt Text</span>
            <div className="text-xs text-gray-600 mt-1">{image.imageAlt}</div>
          </div>
        )}
      </div>
    </div>
  );
}
