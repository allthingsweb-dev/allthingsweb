import { createS3Client } from "@/lib/s3";
import { mainConfig } from "@/lib/config";
import type { Image } from "@/lib/events";

const s3Client = createS3Client({ mainConfig });

export async function signImage(image: Image): Promise<Image> {
  // If it's a local/public image (starts with /), don't sign it
  if (image.url.startsWith("/")) {
    return image;
  }

  // If it's already a signed URL (contains signature params), return as-is
  if (image.url.includes("X-Amz-Signature")) {
    return image;
  }

  try {
    const signedUrl = await s3Client.presign(image.url);
    return {
      ...image,
      url: signedUrl,
    };
  } catch (error) {
    console.error("Failed to sign image:", error);
    // Return original image as fallback
    return image;
  }
}

export async function signImages(images: Image[]): Promise<Image[]> {
  return Promise.all(images.map(signImage));
}
