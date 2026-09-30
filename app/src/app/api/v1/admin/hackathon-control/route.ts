import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { eventsTable } from "@/lib/schema";
import { eq } from "drizzle-orm";

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
    const { eventId, hackathonState, hackUntil, voteUntil } = body;

    if (!eventId || !hackathonState) {
      return NextResponse.json(
        { error: "Event ID and hackathon state are required" },
        { status: 400 },
      );
    }

    // Validate hackathon state
    const validStates = ["before_start", "hacking", "voting", "ended"];
    if (!validStates.includes(hackathonState)) {
      return NextResponse.json(
        { error: "Invalid hackathon state" },
        { status: 400 },
      );
    }

    // Prepare update data
    const updateData: any = {
      hackathonState,
      updatedAt: new Date(),
    };

    // Set started_at timestamps based on state transitions
    const currentEvent = await db
      .select({
        hackathonState: eventsTable.hackathonState,
        hackStartedAt: eventsTable.hackStartedAt,
        voteStartedAt: eventsTable.voteStartedAt,
      })
      .from(eventsTable)
      .where(eq(eventsTable.id, eventId))
      .limit(1);

    if (currentEvent.length === 0) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const current = currentEvent[0];
    const now = new Date();

    // Set hackStartedAt when transitioning to hacking state
    if (hackathonState === "hacking" && current.hackathonState !== "hacking") {
      updateData.hackStartedAt = now;
    }

    // Set voteStartedAt when transitioning to voting state
    if (hackathonState === "voting" && current.hackathonState !== "voting") {
      updateData.voteStartedAt = now;
    }

    // Set hackUntil - handle both provided values and explicit null
    if (hackUntil !== undefined) {
      updateData.hackUntil = hackUntil ? new Date(hackUntil) : null;
    }

    // Set voteUntil - handle both provided values and explicit null
    if (voteUntil !== undefined) {
      updateData.voteUntil = voteUntil ? new Date(voteUntil) : null;
    }

    // Update the event
    await db
      .update(eventsTable)
      .set(updateData)
      .where(eq(eventsTable.id, eventId));

    return NextResponse.json({
      success: true,
      message: "Hackathon state updated successfully",
      data: {
        eventId,
        hackathonState,
        hackStartedAt: updateData.hackStartedAt,
        voteStartedAt: updateData.voteStartedAt,
        hackUntil: updateData.hackUntil,
        voteUntil: updateData.voteUntil,
      },
    });
  } catch (error) {
    console.error("Error updating hackathon state:", error);
    return NextResponse.json(
      { error: "Failed to update hackathon state" },
      { status: 500 },
    );
  }
}

export async function GET() {
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

    // Get all hackathon events
    const hackathonEvents = await db
      .select({
        id: eventsTable.id,
        name: eventsTable.name,
        slug: eventsTable.slug,
        startDate: eventsTable.startDate,
        endDate: eventsTable.endDate,
        hackathonState: eventsTable.hackathonState,
        hackStartedAt: eventsTable.hackStartedAt,
        hackUntil: eventsTable.hackUntil,
        voteStartedAt: eventsTable.voteStartedAt,
        voteUntil: eventsTable.voteUntil,
      })
      .from(eventsTable)
      .where(eq(eventsTable.isHackathon, true))
      .orderBy(eventsTable.startDate);

    return NextResponse.json({
      success: true,
      data: hackathonEvents,
    });
  } catch (error) {
    console.error("Error fetching hackathon events:", error);
    return NextResponse.json(
      { error: "Failed to fetch hackathon events" },
      { status: 500 },
    );
  }
}
