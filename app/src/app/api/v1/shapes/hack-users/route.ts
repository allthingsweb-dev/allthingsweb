import { stackServerApp } from "@/lib/stack";
import { NextRequest, NextResponse } from "next/server";
import { mainConfig } from "@/lib/config";

export async function GET(request: NextRequest) {
  await stackServerApp.getUser({ or: "redirect" });
  try {
    const requestUrl = new URL(request.url);
    const electricUrl = new URL("https://api.electric-sql.cloud/v1/shape");

    // Add Electric SQL credentials
    electricUrl.searchParams.set("source_id", mainConfig.electricSQL.sourceId);
    electricUrl.searchParams.set(
      "source_secret",
      mainConfig.electricSQL.sourceSecret,
    );

    // Forward Electric SQL specific parameters
    requestUrl.searchParams.forEach((value, key) => {
      if (["live", "table", "handle", "offset", "cursor"].includes(key)) {
        electricUrl.searchParams.set(key, value);
      }
    });

    // Set the table name
    electricUrl.searchParams.set("table", "hack_users");

    // Proxy the request to Electric SQL
    const response = await fetch(electricUrl);

    // Remove problematic headers that could break decoding
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error("Electric SQL proxy error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export async function PUT() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export async function DELETE() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
