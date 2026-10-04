import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { isAdmin, getEventImages } from "@/lib/admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
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

    const { eventId } = await params;

    if (!eventId) {
      return NextResponse.json(
        { error: "Event ID is required" },
        { status: 400 },
      );
    }

    // Get existing images for the event
    const images = await getEventImages(eventId);

    return NextResponse.json({
      images,
      count: images.length,
    });
  } catch (error) {
    console.error("Error fetching event images:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
