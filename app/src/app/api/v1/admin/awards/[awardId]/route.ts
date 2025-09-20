import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { awardsTable, hackVotesTable } from "@/lib/schema";
import { eq } from "drizzle-orm";

// GET - Get a specific award
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ awardId: string }> },
) {
  try {
    // Check if user is logged in
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    // Check if user is admin
    const userIsAdmin = await isAdmin(user.id);
    if (!userIsAdmin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }

    const { awardId } = await params;

    // Get the award
    const award = await db
      .select()
      .from(awardsTable)
      .where(eq(awardsTable.id, awardId))
      .limit(1);

    if (award.length === 0) {
      return NextResponse.json({ error: "Award not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: award[0],
    });
  } catch (error) {
    console.error("Error fetching award:", error);
    return NextResponse.json(
      { error: "Failed to fetch award" },
      { status: 500 },
    );
  }
}

// PUT - Update an award
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ awardId: string }> },
) {
  try {
    // Check if user is logged in
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    // Check if user is admin
    const userIsAdmin = await isAdmin(user.id);
    if (!userIsAdmin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }

    const { awardId } = await params;

    // Parse request body
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Award name is required" },
        { status: 400 },
      );
    }

    // Validate name length
    if (name.trim().length === 0) {
      return NextResponse.json(
        { error: "Award name cannot be empty" },
        { status: 400 },
      );
    }

    if (name.length > 100) {
      return NextResponse.json(
        { error: "Award name must be 100 characters or less" },
        { status: 400 },
      );
    }

    // Check if award exists
    const existingAward = await db
      .select()
      .from(awardsTable)
      .where(eq(awardsTable.id, awardId))
      .limit(1);

    if (existingAward.length === 0) {
      return NextResponse.json({ error: "Award not found" }, { status: 404 });
    }

    // Update the award
    const [updatedAward] = await db
      .update(awardsTable)
      .set({
        name: name.trim(),
        updatedAt: new Date(),
      })
      .where(eq(awardsTable.id, awardId))
      .returning();

    return NextResponse.json({
      success: true,
      message: "Award updated successfully",
      data: updatedAward,
    });
  } catch (error) {
    console.error("Error updating award:", error);
    return NextResponse.json(
      { error: "Failed to update award" },
      { status: 500 },
    );
  }
}

// DELETE - Delete an award (only if no votes associated)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ awardId: string }> },
) {
  try {
    // Check if user is logged in
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    // Check if user is admin
    const userIsAdmin = await isAdmin(user.id);
    if (!userIsAdmin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }

    const { awardId } = await params;

    // Check if award exists
    const existingAward = await db
      .select()
      .from(awardsTable)
      .where(eq(awardsTable.id, awardId))
      .limit(1);

    if (existingAward.length === 0) {
      return NextResponse.json({ error: "Award not found" }, { status: 404 });
    }

    // Check if there are any votes associated with this award
    const existingVotes = await db
      .select()
      .from(hackVotesTable)
      .where(eq(hackVotesTable.awardId, awardId))
      .limit(1);

    if (existingVotes.length > 0) {
      return NextResponse.json(
        {
          error:
            "Cannot delete award: votes have been cast for this award. Delete is only allowed for awards without votes.",
        },
        { status: 400 },
      );
    }

    // Delete the award
    await db.delete(awardsTable).where(eq(awardsTable.id, awardId));

    return NextResponse.json({
      success: true,
      message: "Award deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting award:", error);
    return NextResponse.json(
      { error: "Failed to delete award" },
      { status: 500 },
    );
  }
}
