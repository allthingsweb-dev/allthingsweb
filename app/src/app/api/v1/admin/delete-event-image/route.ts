import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { imagesTable, eventImagesTable } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { mainConfig } from "@/lib/config";

const s3Client = new S3Client({
  region: mainConfig.s3.region,
  credentials: {
    accessKeyId: mainConfig.s3.accessKeyId,
    secretAccessKey: mainConfig.s3.secretAccessKey,
  },
});

// Helper function to delete an image from both S3 and database
async function deleteImageFromStorage(imageId: string) {
  try {
    const oldImage = await db
      .select()
      .from(imagesTable)
      .where(eq(imagesTable.id, imageId))
      .limit(1);

    if (oldImage[0]) {
      // Delete from S3 first
      const s3Path = oldImage[0].url.replace(mainConfig.s3.url + "/", "");
      try {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: mainConfig.s3.bucket,
            Key: s3Path,
          }),
        );
      } catch (s3Error) {
        console.error("Error deleting image from S3:", s3Error);
        // Continue with DB deletion even if S3 deletion fails
      }

      // Delete from event_images association table first
      await db
        .delete(eventImagesTable)
        .where(eq(eventImagesTable.imageId, imageId));

      // Delete from images table
      await db.delete(imagesTable).where(eq(imagesTable.id, imageId));
      return true;
    }
    return false;
  } catch (deleteError) {
    console.error("Error deleting image:", deleteError);
    return false;
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Check authentication
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin permissions
    const userIsAdmin = await isAdmin(user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();
    const { imageId } = body;

    if (!imageId) {
      return NextResponse.json(
        { error: "Image ID is required" },
        { status: 400 },
      );
    }

    // Verify image exists and get its details
    const imageRecord = await db
      .select({
        id: imagesTable.id,
        url: imagesTable.url,
        alt: imagesTable.alt,
      })
      .from(imagesTable)
      .where(eq(imagesTable.id, imageId))
      .limit(1);

    if (imageRecord.length === 0) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    // Delete the image
    const deleted = await deleteImageFromStorage(imageId);

    if (deleted) {
      return NextResponse.json({
        message: "Image deleted successfully",
        imageId,
        imageUrl: imageRecord[0].url,
      });
    } else {
      return NextResponse.json(
        { error: "Failed to delete image" },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("Error deleting event image:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
