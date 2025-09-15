"use client";

import { useState, useRef, useCallback } from "react";
import ReactCrop, {
  type Crop,
  type PixelCrop,
  centerCrop,
  makeAspectCrop,
} from "react-image-crop";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Upload, X, Check, Trash2 } from "lucide-react";
import "react-image-crop/dist/ReactCrop.css";

interface ImageUploadCropProps {
  onImageCropped: (croppedImageFile: File) => void;
  onImageRemoved?: () => void;
  currentImageUrl?: string;
  label?: string;
  className?: string;
  aspectRatio?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export function ImageUploadCrop({
  onImageCropped,
  onImageRemoved,
  currentImageUrl,
  label = "Upload Image",
  className = "",
  aspectRatio = 1, // Default to square
  maxWidth = 1200,
  maxHeight = 1200,
}: ImageUploadCropProps) {
  const [imgSrc, setImgSrc] = useState("");
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const imageUrl = reader.result?.toString() || "";
        setImgSrc(imageUrl);
        setIsDialogOpen(true);
      });
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const onImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth: width, naturalHeight: height } = e.currentTarget;

      const crop = centerCrop(
        makeAspectCrop(
          {
            unit: "%",
            width: 90,
          },
          aspectRatio,
          width,
          height,
        ),
        width,
        height,
      );

      setCrop(crop);
    },
    [aspectRatio],
  );

  const getCroppedImg = useCallback(
    async (
      image: HTMLImageElement,
      crop: PixelCrop,
      fileName: string,
    ): Promise<File> => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        throw new Error("No 2d context");
      }

      const scaleX = image.naturalWidth / image.width;
      const scaleY = image.naturalHeight / image.height;

      // Set canvas size to the crop size, but respect max dimensions
      const cropWidth = crop.width * scaleX;
      const cropHeight = crop.height * scaleY;

      let finalWidth = cropWidth;
      let finalHeight = cropHeight;

      // Resize if exceeds max dimensions while maintaining aspect ratio
      if (cropWidth > maxWidth || cropHeight > maxHeight) {
        const ratio = Math.min(maxWidth / cropWidth, maxHeight / cropHeight);
        finalWidth = cropWidth * ratio;
        finalHeight = cropHeight * ratio;
      }

      canvas.width = finalWidth;
      canvas.height = finalHeight;

      ctx.imageSmoothingQuality = "high";

      ctx.drawImage(
        image,
        crop.x * scaleX,
        crop.y * scaleY,
        crop.width * scaleX,
        crop.height * scaleY,
        0,
        0,
        finalWidth,
        finalHeight,
      );

      return new Promise((resolve) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              throw new Error("Canvas is empty");
            }
            const file = new File([blob], fileName, {
              type: "image/jpeg",
            });
            resolve(file);
          },
          "image/jpeg",
          0.9,
        );
      });
    },
    [maxWidth, maxHeight],
  );

  const handleCropComplete = async () => {
    if (!completedCrop || !imgRef.current) {
      return;
    }

    setIsProcessing(true);
    try {
      const croppedImageFile = await getCroppedImg(
        imgRef.current,
        completedCrop,
        "cropped-image.jpg",
      );
      onImageCropped(croppedImageFile);
      setIsDialogOpen(false);
      setImgSrc("");
      setCrop(undefined);
      setCompletedCrop(undefined);

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      console.error("Error cropping image:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = () => {
    setIsDialogOpen(false);
    setImgSrc("");
    setCrop(undefined);
    setCompletedCrop(undefined);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className={className}>
      <Label htmlFor="image-upload" className="block text-sm font-medium mb-2">
        {label}
      </Label>

      {/* Current image preview */}
      {currentImageUrl && (
        <div className="mb-4">
          <img
            src={currentImageUrl}
            alt="Current image"
            className="w-24 h-24 object-cover rounded-lg border"
          />
        </div>
      )}

      {/* Upload and Remove buttons */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2"
        >
          <Upload className="h-4 w-4" />
          {currentImageUrl ? "Change Image" : "Choose Image"}
        </Button>
        {currentImageUrl && onImageRemoved && (
          <Button
            type="button"
            variant="outline"
            onClick={onImageRemoved}
            className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
            Remove
          </Button>
        )}
        <Input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onSelectFile}
          className="hidden"
          id="image-upload"
        />
      </div>

      {/* Crop Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Crop Your Image</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {imgSrc && (
              <div className="flex justify-center">
                <ReactCrop
                  crop={crop}
                  onChange={(_, percentCrop) => setCrop(percentCrop)}
                  onComplete={(c) => setCompletedCrop(c)}
                  aspect={aspectRatio}
                  minWidth={100}
                  minHeight={aspectRatio === 1 ? 100 : 100 / aspectRatio}
                >
                  <img
                    ref={imgRef}
                    alt="Crop me"
                    src={imgSrc}
                    style={{ maxHeight: "60vh", maxWidth: "100%" }}
                    onLoad={onImageLoad}
                  />
                </ReactCrop>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isProcessing}
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleCropComplete}
                disabled={!completedCrop || isProcessing}
              >
                <Check className="h-4 w-4 mr-2" />
                {isProcessing ? "Processing..." : "Apply Crop"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
