import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { db } from "@/lib/db";
import { imagesTable } from "@/lib/schema";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { mainConfig } from "@/lib/config";
import { randomUUID } from "crypto";
import { getImgMetadata, getImgPlaceholder } from "openimg/node";

export async function POST(request: NextRequest) {
  try {
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const imageFile = formData.get("image") as File | null;
    const eventSlug = formData.get("eventSlug") as string | null;

    if (!imageFile || !eventSlug) {
      return NextResponse.json(
        { error: "Image file and event slug are required" },
        { status: 400 },
      );
    }

    // Initialize S3 client
    const s3Client = new S3Client({
      region: mainConfig.s3.region,
      credentials: {
        accessKeyId: mainConfig.s3.accessKeyId,
        secretAccessKey: mainConfig.s3.secretAccessKey,
      },
    });

    const uuid = randomUUID();
    const buf = new Uint8Array(await imageFile.arrayBuffer());

    // Get image metadata
    const metadata = await getImgMetadata(buf);
    if (!metadata) {
      return NextResponse.json(
        { error: "Invalid image file" },
        { status: 400 },
      );
    }

    const { width, height } = metadata;

    // Generate placeholder
    const placeholder = await getImgPlaceholder(buf);

    // Upload to S3
    const s3Path = `events/${eventSlug}/teams/${uuid}.${imageFile.type.split("/")[1]}`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: mainConfig.s3.bucket,
        Key: s3Path,
        Body: buf,
        ContentType: imageFile.type,
      }),
    );

    const imageUrl = `${mainConfig.s3.url}/${s3Path}`;

    // Save to database
    const [savedImage] = await db
      .insert(imagesTable)
      .values({
        id: uuid,
        url: imageUrl,
        width,
        height,
        placeholder,
        alt: "Team image", // Required alt text for accessibility
      })
      .returning();

    return NextResponse.json({
      imageId: savedImage.id,
      imageUrl: savedImage.url,
    });
  } catch (error) {
    console.error("Error uploading team image:", error);
    return NextResponse.json(
      { error: "Failed to upload image" },
      { status: 500 },
    );
  }
}

// Only allow POST method
export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export async function PUT() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export async function DELETE() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
