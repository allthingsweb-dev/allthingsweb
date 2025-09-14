import { NextResponse } from "next/server";
import { getPublishedEvents } from "@/lib/published-events";

export async function GET() {
  try {
    const events = await getPublishedEvents();

    return NextResponse.json({
      events,
    });
  } catch (error) {
    console.error("Error fetching events:", error);
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 },
    );
  }
}
