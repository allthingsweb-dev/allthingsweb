import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { eventsTable, imagesTable, eventImagesTable } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { mainConfig } from "@/lib/config";
import { randomUUID } from "crypto";
import { getImgMetadata, getImgPlaceholder } from "openimg/node";

const s3Client = new S3Client({
  region: mainConfig.s3.region,
  credentials: {
    accessKeyId: mainConfig.s3.accessKeyId,
    secretAccessKey: mainConfig.s3.secretAccessKey,
  },
});

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check admin permissions
    const userIsAdmin = await isAdmin(user.id);
    if (!userIsAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Parse form data
    const formData = await request.formData();
    const eventId = formData.get("eventId") as string;
    const imageFiles = formData.getAll("images") as File[];

    if (!eventId) {
      return NextResponse.json(
        { error: "Event ID is required" },
        { status: 400 },
      );
    }

    if (!imageFiles || imageFiles.length === 0) {
      return NextResponse.json(
        { error: "At least one image file is required" },
        { status: 400 },
      );
    }

    // Verify event exists
    const event = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, eventId))
      .limit(1);

    if (event.length === 0) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const uploadResults = [];
    const uploadedImageIds = [];

    // Upload each image
    for (const imageFile of imageFiles) {
      if (!(imageFile instanceof File)) {
        continue;
      }

      // Validate file type
      if (!imageFile.type.startsWith("image/")) {
        return NextResponse.json(
          { error: `Invalid file type: ${imageFile.name}` },
          { status: 400 },
        );
      }

      try {
        // Convert file to buffer and process image metadata
        const arrayBuffer = await imageFile.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const bufferUint8 = new Uint8Array(arrayBuffer);

        // Get image metadata and placeholder
        const { width, height, format } = await getImgMetadata(bufferUint8);
        const placeholder = await getImgPlaceholder(bufferUint8);

        // Generate unique filename with proper extension
        const uuid = randomUUID();
        const fileName = `events/${eventId}/${uuid}.${format}`;

        // Upload to S3
        const uploadCommand = new PutObjectCommand({
          Bucket: mainConfig.s3.bucket,
          Key: fileName,
          Body: bufferUint8,
          ContentType: imageFile.type,
          Metadata: {
            originalName: imageFile.name,
            uploadedBy: user.id,
            eventId: eventId,
          },
        });

        await s3Client.send(uploadCommand);

        // Create image record in database
        const imageUrl = `${mainConfig.s3.url}/${fileName}`;

        const [imageRecord] = await db
          .insert(imagesTable)
          .values({
            id: uuid,
            url: imageUrl,
            alt: `Event image for ${event[0].name}`,
            width,
            height,
            placeholder,
          })
          .returning();

        // Associate image with event
        await db.insert(eventImagesTable).values({
          eventId: eventId,
          imageId: imageRecord.id,
        });

        uploadResults.push({
          originalName: imageFile.name,
          url: imageUrl,
          imageId: imageRecord.id,
        });

        uploadedImageIds.push(imageRecord.id);
      } catch (error) {
        console.error(`Error uploading ${imageFile.name}:`, error);
        return NextResponse.json(
          { error: `Failed to upload ${imageFile.name}` },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      message: "Images uploaded successfully",
      uploadedCount: uploadResults.length,
      eventId,
      eventName: event[0].name,
      images: uploadResults,
    });
  } catch (error) {
    console.error("Error uploading event images:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
