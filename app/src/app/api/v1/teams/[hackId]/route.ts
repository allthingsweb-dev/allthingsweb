import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { db } from "@/lib/db";
import {
  hacksTable,
  hackUsersTable,
  imagesTable,
  eventsTable,
} from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { isAdmin } from "@/lib/admin";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { mainConfig } from "@/lib/config";
import { randomUUID } from "crypto";
import { getImgMetadata, getImgPlaceholder } from "openimg/node";
import { signImage } from "@/lib/image-signing";

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

// Helper function to sign a team image URL
async function signTeamImageUrl(
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
    console.error("Error signing team image:", error);
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

// GET - Fetch team data for editing
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hackId: string }> },
) {
  try {
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { hackId } = await params;

    // Get team data with image info
    const teamData = await db
      .select({
        hack: hacksTable,
        image: {
          url: imagesTable.url,
          alt: imagesTable.alt,
        },
      })
      .from(hacksTable)
      .leftJoin(imagesTable, eq(hacksTable.teamImage, imagesTable.id))
      .where(eq(hacksTable.id, hackId))
      .limit(1);

    if (!teamData[0]) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const team = teamData[0];

    // Check if user is a member of this team or an admin
    const userIsAdmin = await isAdmin(user.id);

    if (!userIsAdmin) {
      const membership = await db
        .select()
        .from(hackUsersTable)
        .where(
          and(
            eq(hackUsersTable.hackId, hackId),
            eq(hackUsersTable.userId, user.id),
          ),
        )
        .limit(1);

      if (membership.length === 0) {
        return NextResponse.json(
          { error: "You are not a member of this team" },
          { status: 403 },
        );
      }
    }

    // Sign the team image if it exists
    const signedImageUrl = await signTeamImageUrl(team.image?.url || null);

    return NextResponse.json({
      team: {
        ...team.hack,
        imageUrl: signedImageUrl,
        imageAlt: team.image?.alt,
      },
    });
  } catch (error) {
    console.error("Error fetching team data:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PUT - Update team data
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ hackId: string }> },
) {
  try {
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { hackId } = await params;

    // Get existing team data
    const existingTeamData = await db
      .select({
        hack: hacksTable,
        event: eventsTable,
      })
      .from(hacksTable)
      .innerJoin(eventsTable, eq(hacksTable.eventId, eventsTable.id))
      .where(eq(hacksTable.id, hackId))
      .limit(1);

    if (!existingTeamData[0]) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const existingTeam = existingTeamData[0].hack;
    const event = existingTeamData[0].event;

    // Check if user is a member of this team or an admin
    const userIsAdmin = await isAdmin(user.id);

    if (!userIsAdmin) {
      const membership = await db
        .select()
        .from(hackUsersTable)
        .where(
          and(
            eq(hackUsersTable.hackId, hackId),
            eq(hackUsersTable.userId, user.id),
          ),
        )
        .limit(1);

      if (membership.length === 0) {
        return NextResponse.json(
          { error: "You are not a member of this team" },
          { status: 403 },
        );
      }
    }

    const formData = await request.formData();
    const teamName = (formData.get("teamName") as string)?.trim();
    const projectName =
      (formData.get("projectName") as string | null)?.trim() || null;
    const projectDescription =
      (formData.get("projectDescription") as string | null)?.trim() || null;
    const imageFile = formData.get("teamImage") as File | null;

    // Validation
    if (!teamName) {
      return NextResponse.json(
        { error: "Team name is required" },
        { status: 400 },
      );
    }

    let imageId = existingTeam.teamImage;
    let oldImageId = existingTeam.teamImage; // Store old image ID for cleanup

    // Handle image upload if provided
    if (imageFile && imageFile.size > 0) {
      const s3Client = new S3Client({
        region: mainConfig.s3.region,
        credentials: {
          accessKeyId: mainConfig.s3.accessKeyId,
          secretAccessKey: mainConfig.s3.secretAccessKey,
        },
      });

      // Upload new image first
      const uuid = randomUUID();
      const buffer = await imageFile.arrayBuffer();
      const bufferUint8 = new Uint8Array(buffer);

      const { width, height, format } = await getImgMetadata(bufferUint8);
      const teamSlug = slugify(teamName);
      const path = `${event.slug}/hacks/${teamSlug}-${uuid}.${format}`;
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
        alt: `${teamName} team image`,
      });

      imageId = uuid;
    }

    // Update team
    const [updatedTeam] = await db
      .update(hacksTable)
      .set({
        teamName,
        projectName,
        projectDescription,
        teamImage: imageId,
      })
      .where(eq(hacksTable.id, hackId))
      .returning();

    // Clean up old image if we uploaded a new one
    if (
      imageFile &&
      imageFile.size > 0 &&
      oldImageId &&
      oldImageId !== imageId
    ) {
      const s3Client = new S3Client({
        region: mainConfig.s3.region,
        credentials: {
          accessKeyId: mainConfig.s3.accessKeyId,
          secretAccessKey: mainConfig.s3.secretAccessKey,
        },
      });

      // Now it's safe to delete the old image since the team record no longer references it
      await deleteImageFromStorage(oldImageId, s3Client);
    }

    // Get the signed image URL for the response
    let signedImageUrl = null;
    if (imageId) {
      const imageRecord = await db
        .select()
        .from(imagesTable)
        .where(eq(imagesTable.id, imageId))
        .limit(1);

      if (imageRecord[0]) {
        signedImageUrl = await signTeamImageUrl(imageRecord[0].url);
      }
    }

    return NextResponse.json({
      team: {
        ...updatedTeam,
        imageUrl: signedImageUrl,
      },
    });
  } catch (error) {
    console.error("Error updating team:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE - Delete team image only
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ hackId: string }> },
) {
  try {
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { hackId } = await params;

    // Get existing team data
    const existingTeamData = await db
      .select()
      .from(hacksTable)
      .where(eq(hacksTable.id, hackId))
      .limit(1);

    if (!existingTeamData[0]) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const existingTeam = existingTeamData[0];

    // Check if user is a member of this team or an admin
    const userIsAdmin = await isAdmin(user.id);

    if (!userIsAdmin) {
      const membership = await db
        .select()
        .from(hackUsersTable)
        .where(
          and(
            eq(hackUsersTable.hackId, hackId),
            eq(hackUsersTable.userId, user.id),
          ),
        )
        .limit(1);

      if (membership.length === 0) {
        return NextResponse.json(
          { error: "You are not a member of this team" },
          { status: 403 },
        );
      }
    }

    if (!existingTeam.teamImage) {
      return NextResponse.json(
        { error: "No team image to delete" },
        { status: 400 },
      );
    }

    // First, update team to remove image reference
    const [updatedTeam] = await db
      .update(hacksTable)
      .set({
        teamImage: null,
      })
      .where(eq(hacksTable.id, hackId))
      .returning();

    // Then delete the image from storage and database
    const s3Client = new S3Client({
      region: mainConfig.s3.region,
      credentials: {
        accessKeyId: mainConfig.s3.accessKeyId,
        secretAccessKey: mainConfig.s3.secretAccessKey,
      },
    });

    const deleted = await deleteImageFromStorage(
      existingTeam.teamImage,
      s3Client,
    );

    if (deleted) {
      return NextResponse.json({
        message: "Team image deleted successfully",
        team: {
          ...updatedTeam,
          imageUrl: null, // Image was deleted, so URL is null
        },
      });
    } else {
      // Even if image deletion failed, the team reference was removed
      return NextResponse.json({
        message:
          "Team image reference removed, but failed to delete image file",
        team: {
          ...updatedTeam,
          imageUrl: null,
        },
      });
    }
  } catch (error) {
    console.error("Error deleting team image:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
