import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { db } from "@/lib/db";
import { hackVotesTable, hacksTable, awardsTable } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { generateTxId } from "@/lib/tx-utils";

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

    // Parse request body
    const body = await request.json();
    const { hackId, awardId } = body;

    if (!hackId) {
      return NextResponse.json(
        { error: "Hack ID is required" },
        { status: 400 },
      );
    }

    if (!awardId) {
      return NextResponse.json(
        { error: "Award ID is required" },
        { status: 400 },
      );
    }

    // Check if hack exists
    const hack = await db
      .select()
      .from(hacksTable)
      .where(eq(hacksTable.id, hackId))
      .limit(1);

    if (hack.length === 0) {
      return NextResponse.json({ error: "Hack not found" }, { status: 404 });
    }

    // Check if award exists and belongs to the same event as the hack
    const award = await db
      .select()
      .from(awardsTable)
      .where(eq(awardsTable.id, awardId))
      .limit(1);

    if (award.length === 0) {
      return NextResponse.json({ error: "Award not found" }, { status: 404 });
    }

    // Ensure the award belongs to the same event as the hack
    if (award[0].eventId !== hack[0].eventId) {
      return NextResponse.json(
        { error: "Award does not belong to the same event as the hack" },
        { status: 400 },
      );
    }

    // Check if user already voted for this hack for this award
    const existingVote = await db
      .select()
      .from(hackVotesTable)
      .where(
        and(
          eq(hackVotesTable.hackId, hackId),
          eq(hackVotesTable.awardId, awardId),
          eq(hackVotesTable.userId, user.id),
        ),
      )
      .limit(1);

    if (existingVote.length > 0) {
      return NextResponse.json(
        { error: "You have already voted for this hack for this award" },
        { status: 409 },
      );
    }

    // Create the vote
    const newVote = await db
      .insert(hackVotesTable)
      .values({
        hackId,
        awardId,
        userId: user.id,
      })
      .returning();

    // Generate transaction ID for Electric SQL sync
    const txid = await generateTxId();

    return NextResponse.json({
      success: true,
      message: "Vote submitted successfully",
      data: newVote[0],
      txid: txid,
    });
  } catch (error) {
    console.error("Error submitting vote:", error);
    return NextResponse.json(
      { error: "Failed to submit vote" },
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

    // Parse request body
    const body = await request.json();
    const { hackId, awardId } = body;

    if (!hackId) {
      return NextResponse.json(
        { error: "Hack ID is required" },
        { status: 400 },
      );
    }

    if (!awardId) {
      return NextResponse.json(
        { error: "Award ID is required" },
        { status: 400 },
      );
    }

    // Delete the vote
    const deletedVote = await db
      .delete(hackVotesTable)
      .where(
        and(
          eq(hackVotesTable.hackId, hackId),
          eq(hackVotesTable.awardId, awardId),
          eq(hackVotesTable.userId, user.id),
        ),
      )
      .returning();

    if (deletedVote.length === 0) {
      return NextResponse.json({ error: "Vote not found" }, { status: 404 });
    }

    // Generate transaction ID for Electric SQL sync
    const txid = await generateTxId();

    return NextResponse.json({
      success: true,
      message: "Vote removed successfully",
      data: deletedVote[0],
      txid: txid,
    });
  } catch (error) {
    console.error("Error removing vote:", error);
    return NextResponse.json(
      { error: "Failed to remove vote" },
      { status: 500 },
    );
  }
}
