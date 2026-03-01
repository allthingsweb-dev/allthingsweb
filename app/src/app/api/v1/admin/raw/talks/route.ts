import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { profilesTable, talkSpeakersTable, talksTable } from "@/lib/schema";
import { eq, inArray } from "drizzle-orm";

function parseSpeakerIds(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return Array.from(
    new Set(
      input
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

export async function POST(request: NextRequest) {
  try {
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const userIsAdmin = await isAdmin(user.id);
    if (!userIsAdmin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const title = (body.title as string | undefined)?.trim() ?? "";
    const description = (body.description as string | undefined)?.trim() ?? "";
    const speakerIds = parseSpeakerIds(body.speakerIds);

    if (!title || !description) {
      return NextResponse.json(
        { error: "title and description are required" },
        { status: 400 },
      );
    }

    if (speakerIds.length === 0) {
      return NextResponse.json(
        { error: "At least one speaker ID is required" },
        { status: 400 },
      );
    }

    const existingSpeakers = await db
      .select({ id: profilesTable.id })
      .from(profilesTable)
      .where(inArray(profilesTable.id, speakerIds));

    if (existingSpeakers.length !== speakerIds.length) {
      return NextResponse.json(
        { error: "One or more selected speakers do not exist" },
        { status: 400 },
      );
    }

    const [talk] = await db
      .insert(talksTable)
      .values({
        title,
        description,
      })
      .returning();

    await db.insert(talkSpeakersTable).values(
      speakerIds.map((speakerId) => ({
        talkId: talk.id,
        speakerId,
      })),
    );

    return NextResponse.json(
      { talk, speakerIds, speakerCount: speakerIds.length },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating raw talk:", error);
    return NextResponse.json(
      { error: "Failed to create talk" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const userIsAdmin = await isAdmin(user.id);
    if (!userIsAdmin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }

    const body = await request.json();
    const talkId = (body.talkId as string | undefined)?.trim() ?? "";
    const title = (body.title as string | undefined)?.trim() ?? "";
    const description = (body.description as string | undefined)?.trim() ?? "";
    const speakerIds = parseSpeakerIds(body.speakerIds);

    if (!talkId || !title || !description) {
      return NextResponse.json(
        { error: "talkId, title and description are required" },
        { status: 400 },
      );
    }
    if (speakerIds.length === 0) {
      return NextResponse.json(
        { error: "At least one speaker ID is required" },
        { status: 400 },
      );
    }

    const existingTalk = await db
      .select({ id: talksTable.id })
      .from(talksTable)
      .where(eq(talksTable.id, talkId))
      .limit(1);
    if (!existingTalk[0]) {
      return NextResponse.json({ error: "Talk not found" }, { status: 404 });
    }

    const existingSpeakers = await db
      .select({ id: profilesTable.id })
      .from(profilesTable)
      .where(inArray(profilesTable.id, speakerIds));

    if (existingSpeakers.length !== speakerIds.length) {
      return NextResponse.json(
        { error: "One or more selected speakers do not exist" },
        { status: 400 },
      );
    }

    const [talk] = await db
      .update(talksTable)
      .set({ title, description })
      .where(eq(talksTable.id, talkId))
      .returning();

    await db
      .delete(talkSpeakersTable)
      .where(eq(talkSpeakersTable.talkId, talkId));
    await db.insert(talkSpeakersTable).values(
      speakerIds.map((speakerId) => ({
        talkId,
        speakerId,
      })),
    );

    return NextResponse.json({
      talk,
      speakerIds,
      speakerCount: speakerIds.length,
    });
  } catch (error) {
    console.error("Error updating raw talk:", error);
    return NextResponse.json(
      { error: "Failed to update talk" },
      { status: 500 },
    );
  }
}
