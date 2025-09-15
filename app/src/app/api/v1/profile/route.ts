import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { db } from "@/lib/db";
import { profilesTable, profileUsersTable, imagesTable } from "@/lib/schema";
import { eq } from "drizzle-orm";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { mainConfig } from "@/lib/config";
import { randomUUID } from "crypto";
import { getImgMetadata, getImgPlaceholder } from "openimg/node";
import { signImage } from "@/lib/image-signing";

// Helper function to sign a profile image URL
async function signProfileImageUrl(
  imageUrl: string | null,
): Promise<string | null> {
  if (!imageUrl) return null;

  try {
    const signedImage = await signImage({
      url: imageUrl,
      alt: "", // We don't need alt for signing
      placeholder: "", // We don't need placeholder for signing
      width: 0, // We don't need dimensions for signing
      height: 0,
    });
    return signedImage.url;
  } catch (error) {
    console.error("Error signing profile image:", error);
    // Fall back to unsigned URL
    return imageUrl;
  }
}

// Helper function to delete an image from both S3 and database
async function deleteImageFromStorage(imageId: string, s3Client: S3Client) {
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

    // Sign the profile image if it exists
    const signedImageUrl = await signProfileImageUrl(result.image?.url || null);

    return NextResponse.json({
      profile: {
        ...result.profile,
        imageUrl: signedImageUrl,
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
      const s3Client = new S3Client({
        region: mainConfig.s3.region,
        credentials: {
          accessKeyId: mainConfig.s3.accessKeyId,
          secretAccessKey: mainConfig.s3.secretAccessKey,
        },
      });

      const uuid = randomUUID();
      const buffer = await imageFile.arrayBuffer();
      const bufferUint8 = new Uint8Array(buffer);

      const { width, height, format } = await getImgMetadata(bufferUint8);
      const nameSlug = name.toLowerCase().replace(/ /g, "-");
      const path = `profiles/${nameSlug}-${uuid}.${format}`;
      const placeholder = await getImgPlaceholder(bufferUint8);

      // Upload to S3
      await s3Client.send(
        new PutObjectCommand({
          Bucket: mainConfig.s3.bucket,
          Key: path,
          Body: bufferUint8,
          ContentType: imageFile.type,
        }),
      );

      const url = `${mainConfig.s3.url}/${path}`;

      // Save image record
      await db.insert(imagesTable).values({
        url,
        id: uuid,
        width,
        height,
        placeholder,
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

    // Get the signed image URL for the response
    let signedImageUrl = null;
    if (imageId) {
      const imageRecord = await db
        .select()
        .from(imagesTable)
        .where(eq(imagesTable.id, imageId))
        .limit(1);

      if (imageRecord[0]) {
        signedImageUrl = await signProfileImageUrl(imageRecord[0].url);
      }
    }

    return NextResponse.json(
      {
        profile: {
          ...newProfile,
          imageUrl: signedImageUrl,
        },
      },
      { status: 201 },
    );
  } catch (error) {
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

    // Handle image upload if provided
    if (imageFile && imageFile.size > 0) {
      const s3Client = new S3Client({
        region: mainConfig.s3.region,
        credentials: {
          accessKeyId: mainConfig.s3.accessKeyId,
          secretAccessKey: mainConfig.s3.secretAccessKey,
        },
      });

      // Delete old image if exists
      if (existingProfile.image) {
        await deleteImageFromStorage(existingProfile.image, s3Client);
      }

      // Upload new image
      const uuid = randomUUID();
      const buffer = await imageFile.arrayBuffer();
      const bufferUint8 = new Uint8Array(buffer);

      const { width, height, format } = await getImgMetadata(bufferUint8);
      const nameSlug = name.toLowerCase().replace(/ /g, "-");
      const path = `profiles/${nameSlug}-${uuid}.${format}`;
      const placeholder = await getImgPlaceholder(bufferUint8);

      await s3Client.send(
        new PutObjectCommand({
          Bucket: mainConfig.s3.bucket,
          Key: path,
          Body: bufferUint8,
          ContentType: imageFile.type,
        }),
      );

      const url = `${mainConfig.s3.url}/${path}`;

      await db.insert(imagesTable).values({
        url,
        id: uuid,
        width,
        height,
        placeholder,
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

    // Get the signed image URL for the response
    let signedImageUrl = null;
    if (imageId) {
      const imageRecord = await db
        .select()
        .from(imagesTable)
        .where(eq(imagesTable.id, imageId))
        .limit(1);

      if (imageRecord[0]) {
        signedImageUrl = await signProfileImageUrl(imageRecord[0].url);
      }
    }

    return NextResponse.json({
      profile: {
        ...updatedProfile,
        imageUrl: signedImageUrl,
      },
    });
  } catch (error) {
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
    const s3Client = new S3Client({
      region: mainConfig.s3.region,
      credentials: {
        accessKeyId: mainConfig.s3.accessKeyId,
        secretAccessKey: mainConfig.s3.secretAccessKey,
      },
    });

    const deleted = await deleteImageFromStorage(
      existingProfile.image,
      s3Client,
    );

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
