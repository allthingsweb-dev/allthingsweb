import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { imagesTable, eventImagesTable } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { removeStoredObject } from "@/lib/media-store";

// Deletes an image from both the media store and the database
async function deleteImageFromStorage(imageId: string) {
  try {
    const oldImage = await db
      .select()
      .from(imagesTable)
      .where(eq(imagesTable.id, imageId))
      .limit(1);

    if (oldImage[0]) {
      try {
        await removeStoredObject(oldImage[0].url);
      } catch (storageError) {
        console.error("Error deleting image from storage:", storageError);
        // Continue with DB deletion even if storage deletion fails
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
