import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { eventsTable, imagesTable, eventImagesTable } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { mainConfig } from "@/lib/config";
import { randomUUID } from "crypto";
import { processImage } from "@/lib/image-processor";

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
    const imageFile = formData.get("image") as File;

    if (!eventId) {
      return NextResponse.json(
        { error: "Event ID is required" },
        { status: 400 },
      );
    }

    if (!imageFile || !(imageFile instanceof File)) {
      return NextResponse.json(
        { error: "Image file is required" },
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

    // Validate file type
    if (!imageFile.type.startsWith("image/")) {
      return NextResponse.json(
        { error: `Invalid file type: ${imageFile.name}` },
        { status: 400 },
      );
    }

    try {
      // Process image using our new utility
      const processedImage = await processImage(imageFile, imageFile.name, {
        convertUnsupportedFormats: true,
        conversionFormat: "PNG",
      });

      // Generate unique filename with proper extension
      const uuid = randomUUID();
      const fileName = `events/${eventId}/${uuid}.${processedImage.metadata.format}`;

      console.log(
        `Processing ${imageFile.name}: original=${processedImage.originalFormat}, final=${processedImage.metadata.format}, converted=${processedImage.wasConverted}, uuid=${uuid}`,
      );

      // Upload to S3
      const uploadCommand = new PutObjectCommand({
        Bucket: mainConfig.s3.bucket,
        Key: fileName,
        Body: processedImage.buffer,
        ContentType: `image/${processedImage.metadata.format}`,
        Metadata: {
          originalName: imageFile.name,
          uploadedBy: user.id,
          eventId: eventId,
          originalFormat: processedImage.originalFormat,
          wasConverted: processedImage.wasConverted.toString(),
        },
      });

      await s3Client.send(uploadCommand);

      // Create image record in database
      const imageUrl = `${mainConfig.s3.url}/${fileName}`;

      console.log(
        `Inserting image record: id=${uuid}, url=${imageUrl}, width=${processedImage.metadata.width}, height=${processedImage.metadata.height}`,
      );

      const [imageRecord] = await db
        .insert(imagesTable)
        .values({
          id: uuid,
          url: imageUrl,
          alt: `Event image for ${event[0].name}`,
          width: processedImage.metadata.width,
          height: processedImage.metadata.height,
          placeholder: processedImage.placeholder,
        })
        .returning();

      // Associate image with event
      await db.insert(eventImagesTable).values({
        eventId: eventId,
        imageId: imageRecord.id,
      });

      return NextResponse.json({
        message: "Image uploaded successfully",
        eventId,
        eventName: event[0].name,
        image: {
          originalName: imageFile.name,
          url: imageUrl,
          imageId: imageRecord.id,
          originalFormat: processedImage.originalFormat,
          wasConverted: processedImage.wasConverted,
        },
      });
    } catch (error) {
      console.error(`Error uploading ${imageFile.name}:`, error);

      // Provide more specific error messages
      let errorMessage = `Failed to upload ${imageFile.name}`;
      if (error instanceof Error) {
        if (error.message.includes("pattern")) {
          errorMessage = `Invalid file format or name pattern for ${imageFile.name}: ${error.message}`;
        } else if (error.message.includes("constraint")) {
          errorMessage = `Database constraint violation for ${imageFile.name}: ${error.message}`;
        } else {
          errorMessage = `${errorMessage}: ${error.message}`;
        }
      }

      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
  } catch (error) {
    console.error("Error uploading event images:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
