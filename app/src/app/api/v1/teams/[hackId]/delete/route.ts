import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { db } from "@/lib/db";
import {
  hacksTable,
  hackUsersTable,
  hackVotesTable,
  imagesTable,
} from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { mainConfig } from "@/lib/config";
import { isAdmin } from "@/lib/admin";

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

// DELETE - Delete entire team (only if no votes exist)
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

    // Check if team has any votes - prevent deletion unless admin
    const existingVotes = await db
      .select()
      .from(hackVotesTable)
      .where(eq(hackVotesTable.hackId, hackId))
      .limit(1);

    if (existingVotes.length > 0 && !userIsAdmin) {
      return NextResponse.json(
        {
          error:
            "Cannot delete team: votes have been cast for this team. Team deletion is only allowed before voting begins.",
        },
        { status: 400 },
      );
    }

    // Delete team image if exists
    if (existingTeam.teamImage) {
      const s3Client = new S3Client({
        region: mainConfig.s3.region,
        credentials: {
          accessKeyId: mainConfig.s3.accessKeyId,
          secretAccessKey: mainConfig.s3.secretAccessKey,
        },
      });

      await deleteImageFromStorage(existingTeam.teamImage, s3Client);
    }

    // If admin is deleting a team with votes, delete votes first
    if (existingVotes.length > 0 && userIsAdmin) {
      await db.delete(hackVotesTable).where(eq(hackVotesTable.hackId, hackId));
    }

    // Delete team members (junction table entries)
    await db.delete(hackUsersTable).where(eq(hackUsersTable.hackId, hackId));

    // Delete the team itself
    await db.delete(hacksTable).where(eq(hacksTable.id, hackId));

    return NextResponse.json({
      message: "Team deleted successfully",
      teamId: hackId,
    });
  } catch (error) {
    console.error("Error deleting team:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// Only allow DELETE method
export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export async function POST() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export async function PUT() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
