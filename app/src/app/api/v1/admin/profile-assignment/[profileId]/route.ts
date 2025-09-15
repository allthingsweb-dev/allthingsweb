import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { isAdmin, getProfileWithUser } from "@/lib/admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> },
) {
  const { profileId } = await params;

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

    if (!profileId) {
      return NextResponse.json(
        { error: "Profile ID is required" },
        { status: 400 },
      );
    }

    // Get profile with current user assignment
    const profileWithUser = await getProfileWithUser(profileId);

    return NextResponse.json({
      profileWithUser,
    });
  } catch (error) {
    console.error("Error fetching profile assignment:", error);
    return NextResponse.json(
      { error: "Failed to fetch profile assignment" },
      { status: 500 },
    );
  }
}
