import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { db } from "@/lib/db";
import { profilesTable, profileUsersTable, imagesTable } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { processImage } from "@/lib/image-processor";
import {
  appMediaStore,
  MediaTooLargeError,
  removeStoredObject,
} from "@/lib/media-store";
import { profilePhotoKey } from "@/lib/profile-photos/ingest";

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

      // Delete from database
      await db.delete(imagesTable).where(eq(imagesTable.id, imageId));
      return true;
    }
    return false;
  } catch (deleteError) {
    console.error("Error deleting image:", deleteError);
    return false;
  }
}

// GET - Fetch current user's profile
export async function GET() {
  try {
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Find profile associated with this user
    const profileAssociation = await db
      .select({
        profile: profilesTable,
        image: {
          url: imagesTable.url,
          alt: imagesTable.alt,
        },
      })
      .from(profileUsersTable)
      .leftJoin(
        profilesTable,
        eq(profileUsersTable.profileId, profilesTable.id),
      )
      .leftJoin(imagesTable, eq(profilesTable.image, imagesTable.id))
      .where(eq(profileUsersTable.userId, user.id))
      .limit(1);

    const result = profileAssociation[0];

    if (!result?.profile) {
      return NextResponse.json({ profile: null });
    }

    return NextResponse.json({
      profile: {
        ...result.profile,
        imageUrl: result.image?.url || null,
        imageAlt: result.image?.alt,
      },
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST - Create new profile for current user
export async function POST(request: NextRequest) {
  try {
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user already has a profile
    const existingProfile = await db
      .select()
      .from(profileUsersTable)
      .where(eq(profileUsersTable.userId, user.id))
      .limit(1);

    if (existingProfile.length > 0) {
      return NextResponse.json(
        { error: "User already has a profile" },
        { status: 400 },
      );
    }

    const formData = await request.formData();
    const name = formData.get("name") as string;
    const title = formData.get("title") as string;
    const bio = formData.get("bio") as string;
    const twitterHandle = formData.get("twitterHandle") as string | null;
    const blueskyHandle = formData.get("blueskyHandle") as string | null;
    const linkedinHandle = formData.get("linkedinHandle") as string | null;
    const imageFile = formData.get("image") as File | null;

    // Validation
    if (!name || !title || !bio) {
      return NextResponse.json(
        { error: "Missing required fields: name, title, bio" },
        { status: 400 },
      );
    }

    let imageId: string | null = null;

    // Handle image upload if provided
    if (imageFile && imageFile.size > 0) {
      const uuid = randomUUID();

      // Process image using our new utility
      const processedImage = await processImage(imageFile, imageFile.name, {
        convertUnsupportedFormats: true,
        conversionFormat: "PNG",
      });

      const path = profilePhotoKey(name, uuid, processedImage.metadata.format);

      const url = await appMediaStore().put(
        path,
        processedImage.buffer,
        `image/${processedImage.metadata.format}`,
      );

      // Save image record
      await db.insert(imagesTable).values({
        url,
        id: uuid,
        width: processedImage.metadata.width,
        height: processedImage.metadata.height,
        placeholder: processedImage.placeholder,
        alt: `${name} profile image`,
      });

      imageId = uuid;
    }

    // Create profile
    const [newProfile] = await db
      .insert(profilesTable)
      .values({
        name,
        title,
        bio,
        profileType: "member", // Default to member for user-created profiles
        twitterHandle: twitterHandle || null,
        blueskyHandle: blueskyHandle || null,
        linkedinHandle: linkedinHandle || null,
        image: imageId,
      })
      .returning();

    // Associate profile with user
    await db.insert(profileUsersTable).values({
      profileId: newProfile.id,
      userId: user.id,
    });

    // Get the image URL for the response
    let imageUrl: string | null = null;
    if (imageId) {
      const imageRecord = await db
        .select()
        .from(imagesTable)
        .where(eq(imagesTable.id, imageId))
        .limit(1);

      imageUrl = imageRecord[0]?.url ?? null;
    }

    return NextResponse.json(
      {
        profile: {
          ...newProfile,
          imageUrl,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof MediaTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    console.error("Error creating profile:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PUT - Update existing profile for current user
export async function PUT(request: NextRequest) {
  try {
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Find user's profile
    const profileAssociation = await db
      .select({
        profile: profilesTable,
      })
      .from(profileUsersTable)
      .leftJoin(
        profilesTable,
        eq(profileUsersTable.profileId, profilesTable.id),
      )
      .where(eq(profileUsersTable.userId, user.id))
      .limit(1);

    const existingProfile = profileAssociation[0]?.profile;
    if (!existingProfile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const formData = await request.formData();
    const name = formData.get("name") as string;
    const title = formData.get("title") as string;
    const bio = formData.get("bio") as string;
    const twitterHandle = formData.get("twitterHandle") as string | null;
    const blueskyHandle = formData.get("blueskyHandle") as string | null;
    const linkedinHandle = formData.get("linkedinHandle") as string | null;
    const imageFile = formData.get("image") as File | null;

    // Validation
    if (!name || !title || !bio) {
      return NextResponse.json(
        { error: "Missing required fields: name, title, bio" },
        { status: 400 },
      );
    }

    let imageId = existingProfile.image;

    // Handle image upload if provided. The old image is removed only once
    // the profile points at the new one, so a replacement that can't be
    // stored (one over the size limit, say) leaves the profile as it was.
    if (imageFile && imageFile.size > 0) {
      const uuid = randomUUID();

      // Process image using our new utility
      const processedImage = await processImage(imageFile, imageFile.name, {
        convertUnsupportedFormats: true,
        conversionFormat: "PNG",
      });

      const path = profilePhotoKey(name, uuid, processedImage.metadata.format);

      const url = await appMediaStore().put(
        path,
        processedImage.buffer,
        `image/${processedImage.metadata.format}`,
      );

      await db.insert(imagesTable).values({
        url,
        id: uuid,
        width: processedImage.metadata.width,
        height: processedImage.metadata.height,
        placeholder: processedImage.placeholder,
        alt: `${name} profile image`,
      });

      imageId = uuid;
    }

    // Update profile
    const [updatedProfile] = await db
      .update(profilesTable)
      .set({
        name,
        title,
        bio,
        twitterHandle: twitterHandle || null,
        blueskyHandle: blueskyHandle || null,
        linkedinHandle: linkedinHandle || null,
        image: imageId,
      })
      .where(eq(profilesTable.id, existingProfile.id))
      .returning();

    if (existingProfile.image && existingProfile.image !== imageId) {
      await deleteImageFromStorage(existingProfile.image);
    }

    // Get the image URL for the response
    let imageUrl: string | null = null;
    if (imageId) {
      const imageRecord = await db
        .select()
        .from(imagesTable)
        .where(eq(imagesTable.id, imageId))
        .limit(1);

      imageUrl = imageRecord[0]?.url ?? null;
    }

    return NextResponse.json({
      profile: {
        ...updatedProfile,
        imageUrl,
      },
    });
  } catch (error) {
    if (error instanceof MediaTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    console.error("Error updating profile:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE - Delete profile image only (not the entire profile)
export async function DELETE() {
  try {
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Find user's profile
    const profileAssociation = await db
      .select({
        profile: profilesTable,
      })
      .from(profileUsersTable)
      .leftJoin(
        profilesTable,
        eq(profileUsersTable.profileId, profilesTable.id),
      )
      .where(eq(profileUsersTable.userId, user.id))
      .limit(1);

    const existingProfile = profileAssociation[0]?.profile;
    if (!existingProfile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    if (!existingProfile.image) {
      return NextResponse.json(
        { error: "No profile image to delete" },
        { status: 400 },
      );
    }

    // Delete the image

    const deleted = await deleteImageFromStorage(existingProfile.image);

    if (deleted) {
      // Update profile to remove image reference
      const [updatedProfile] = await db
        .update(profilesTable)
        .set({
          image: null,
        })
        .where(eq(profilesTable.id, existingProfile.id))
        .returning();

      return NextResponse.json({
        message: "Profile image deleted successfully",
        profile: {
          ...updatedProfile,
          imageUrl: null, // Image was deleted, so URL is null
        },
      });
    } else {
      return NextResponse.json(
        { error: "Failed to delete profile image" },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("Error deleting profile image:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
