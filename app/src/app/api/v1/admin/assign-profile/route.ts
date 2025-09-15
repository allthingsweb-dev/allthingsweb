import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import {
  isAdmin,
  assignProfileToUser,
  removeProfileUserAssignment,
} from "@/lib/admin";

export async function POST(request: NextRequest) {
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

    // Parse request body
    const body = await request.json();
    const { profileId, userId } = body;

    if (!profileId || !userId) {
      return NextResponse.json(
        { error: "Profile ID and User ID are required" },
        { status: 400 },
      );
    }

    // Assign profile to user
    await assignProfileToUser(profileId, userId);

    return NextResponse.json({
      success: true,
      message: "Profile assigned successfully",
    });
  } catch (error) {
    console.error("Error assigning profile:", error);
    return NextResponse.json(
      { error: "Failed to assign profile" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
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

    // Parse request body
    const body = await request.json();
    const { profileId } = body;

    if (!profileId) {
      return NextResponse.json(
        { error: "Profile ID is required" },
        { status: 400 },
      );
    }

    // Remove profile-user assignment
    await removeProfileUserAssignment(profileId);

    return NextResponse.json({
      success: true,
      message: "Assignment removed successfully",
    });
  } catch (error) {
    console.error("Error removing assignment:", error);
    return NextResponse.json(
      { error: "Failed to remove assignment" },
      { status: 500 },
    );
  }
}
