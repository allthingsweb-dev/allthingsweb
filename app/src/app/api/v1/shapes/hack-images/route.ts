import { NextRequest, NextResponse } from "next/server";
import { mainConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { hacksTable, SelectImage } from "@/lib/schema";
import { createS3Client } from "@/lib/s3";

export async function GET(request: NextRequest) {
  try {
    const hackImageIds = await db
      .select({ imageId: hacksTable.teamImage })
      .from(hacksTable);

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
    electricUrl.searchParams.set("table", "images");
    // Filter for only the hack image ids
    electricUrl.searchParams.set(
      "where",
      `id IN (${hackImageIds.map((hackImage) => `'${hackImage.imageId}'`).join(",")})`,
    );

    // Proxy the request to Electric SQL
    const response = await fetch(electricUrl);

    // Remove problematic headers that could break decoding
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");

    const imagesData = await response.json();
    if (Array.isArray(imagesData)) {
      const s3Client = createS3Client({ mainConfig });
      const promises: Promise<string>[] = [];
      for (let i = 0; i < imagesData.length; i++) {
        if (!("value" in imagesData[i])) {
          continue;
        }
        promises.push(s3Client.presign(imagesData[i].value.url));
      }
      const signedUrls = await Promise.all(promises);
      for (let i = 0; i < imagesData.length; i++) {
        if (!("value" in imagesData[i])) {
          continue;
        }
        imagesData[i].value.url = signedUrls[i];
      }
    }

    return new Response(JSON.stringify(imagesData), {
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
