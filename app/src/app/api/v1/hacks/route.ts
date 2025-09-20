import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { db } from "@/lib/db";
import { hacksTable } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { generateTxId } from "@/lib/tx-utils";

// POST - Create new hack (team)
export async function POST(request: NextRequest) {
  try {
    console.log("🚀 POST /api/v1/hacks - Starting hack creation");

    const user = await stackServerApp.getUser();
    console.log("👤 POST /api/v1/hacks - User authentication", {
      userId: user?.id,
      userEmail: user?.primaryEmail,
      authenticated: !!user,
    });

    if (!user) {
      console.warn("❌ POST /api/v1/hacks - Unauthorized access attempt");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    console.log("📥 POST /api/v1/hacks - Request body", { body });

    // Transform field names from snake_case to camelCase for Drizzle schema
    const insertData = {
      id: body.id,
      eventId: body.event_id,
      teamName: body.team_name,
      projectName: body.project_name,
      projectDescription: body.project_description,
      teamImage: body.team_image,
    };
    console.log("💾 POST /api/v1/hacks - Inserting into database", {
      insertData,
    });

    // Insert the new hack and get the transaction ID
    const [newHack] = await db
      .insert(hacksTable)
      .values(insertData)
      .returning();

    console.log("✅ POST /api/v1/hacks - Database insert successful", {
      newHack,
    });

    // Generate transaction ID for Electric SQL sync
    const txid = await generateTxId();
    console.log("🔄 POST /api/v1/hacks - Generated txid", { txid });

    const response = {
      message: "Hack created successfully",
      hack: newHack,
      txid: txid,
    };
    console.log("📤 POST /api/v1/hacks - Sending response", { response });

    return NextResponse.json(response);
  } catch (error) {
    console.error("❌ POST /api/v1/hacks - Error creating hack:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PUT - Update existing hack
export async function PUT(request: NextRequest) {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

// DELETE - Delete hack
export async function DELETE(request: NextRequest) {
  try {
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const hackId = url.pathname.split("/").pop();

    if (!hackId) {
      return NextResponse.json({ error: "Hack ID required" }, { status: 400 });
    }

    // Delete the hack
    await db.delete(hacksTable).where(eq(hacksTable.id, hackId));

    // Generate transaction ID for Electric SQL sync
    const txid = await generateTxId();

    return NextResponse.json({
      message: "Hack deleted successfully",
      txid: txid,
    });
  } catch (error) {
    console.error("Error deleting hack:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// GET - List hacks
export async function GET(request: NextRequest) {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
