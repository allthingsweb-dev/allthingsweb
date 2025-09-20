import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { awardsTable, hackVotesTable } from "@/lib/schema";
import { eq, and } from "drizzle-orm";

// GET - List all awards for a specific event
export async function GET(request: NextRequest) {
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

    // Get eventId from query params
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get("eventId");

    if (!eventId) {
      return NextResponse.json(
        { error: "Event ID is required" },
        { status: 400 },
      );
    }

    // Get all awards for the event
    const awards = await db
      .select()
      .from(awardsTable)
      .where(eq(awardsTable.eventId, eventId))
      .orderBy(awardsTable.createdAt);

    return NextResponse.json({
      success: true,
      data: awards,
    });
  } catch (error) {
    console.error("Error fetching awards:", error);
    return NextResponse.json(
      { error: "Failed to fetch awards" },
      { status: 500 },
    );
  }
}

// POST - Create a new award
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
    const { eventId, name } = body;

    if (!eventId || !name) {
      return NextResponse.json(
        { error: "Event ID and name are required" },
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

    // Create the award
    const [newAward] = await db
      .insert(awardsTable)
      .values({
        eventId,
        name: name.trim(),
      })
      .returning();

    return NextResponse.json({
      success: true,
      message: "Award created successfully",
      data: newAward,
    });
  } catch (error) {
    console.error("Error creating award:", error);
    return NextResponse.json(
      { error: "Failed to create award" },
      { status: 500 },
    );
  }
}
