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

    // Filter out null image IDs
    const validImageIds = hackImageIds
      .map((hackImage) => hackImage.imageId)
      .filter((imageId): imageId is string => imageId !== null);

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

    // Only add WHERE clause if we have valid image IDs
    if (validImageIds.length > 0) {
      electricUrl.searchParams.set(
        "where",
        `id IN (${validImageIds.map((imageId) => `'${imageId}'`).join(",")})`,
      );
    } else {
      // If no valid image IDs, return empty result
      electricUrl.searchParams.set("where", "1=0"); // Always false condition
    }

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
      const validIndices: number[] = [];

      for (let i = 0; i < imagesData.length; i++) {
        if (!("value" in imagesData[i]) || !imagesData[i].value.url) {
          continue;
        }
        promises.push(s3Client.presign(imagesData[i].value.url));
        validIndices.push(i);
      }

      const signedUrls = await Promise.all(promises);
      for (let j = 0; j < validIndices.length; j++) {
        const i = validIndices[j];
        imagesData[i].value.url = signedUrls[j];
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
