import { NextResponse } from "next/server";
import { getSpeakersWithTalks } from "@/lib/speakers";

export async function GET() {
  try {
    const { speakers } = await getSpeakersWithTalks();

    return NextResponse.json({
      speakers,
    });
  } catch (error) {
    console.error("Error fetching speakers:", error);
    return NextResponse.json(
      { error: "Failed to fetch speakers" },
      { status: 500 },
    );
  }
}
