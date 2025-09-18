import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { db } from "@/lib/db";
import { eventsTable, imagesTable, hacksTable, hackUsersTable } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { mainConfig } from "@/lib/config";
import { randomUUID } from "crypto";
import { getImgMetadata, getImgPlaceholder } from "openimg/node";

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const user = await stackServerApp.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;

    // Load event by slug
    const eventRows = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.slug, slug))
      .limit(1);
    const event = eventRows[0];
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    if (!event.isHackathon) {
      return NextResponse.json({ error: "Not a hackathon" }, { status: 400 });
    }
    if (event.endDate < new Date()) {
      return NextResponse.json({ error: "Event has ended" }, { status: 400 });
    }

    const formData = await request.formData();
    const teamName = (formData.get("teamName") as string)?.trim();
    const projectName = (formData.get("projectName") as string | null)?.trim() || null;
    const projectDescription = (formData.get("projectDescription") as string | null)?.trim() || null;
    const imageFile = formData.get("teamImage") as File | null;
    const memberIdsJson = formData.get("memberIds") as string | null; // JSON array of user IDs
    const memberIds: string[] = memberIdsJson ? JSON.parse(memberIdsJson) : [];

    if (!teamName) {
      return NextResponse.json({ error: "Missing teamName" }, { status: 400 });
    }

    let imageId: string | null = null;
    if (imageFile && imageFile.size > 0) {
      const s3Client = new S3Client({
        region: mainConfig.s3.region,
        credentials: {
          accessKeyId: mainConfig.s3.accessKeyId,
          secretAccessKey: mainConfig.s3.secretAccessKey,
        },
      });

      const uuid = randomUUID();
      const buf = new Uint8Array(await imageFile.arrayBuffer());
      const { width, height, format } = await getImgMetadata(buf);
      const placeholder = await getImgPlaceholder(buf);
      const teamSlug = slugify(teamName);
      const key = `${slug}/hacks/${teamSlug}-${uuid}.${format}`;

      await s3Client.send(
        new PutObjectCommand({
          Bucket: mainConfig.s3.bucket,
          Key: key,
          Body: buf,
          ContentType: imageFile.type,
        }),
      );

      const url = `${mainConfig.s3.url}/${key}`;
      // Save image record
      await db.insert(imagesTable).values({
        id: uuid,
        url,
        width,
        height,
        placeholder,
        alt: `${teamName} team image`,
      });
      imageId = uuid;
    }

    // Create hack
    const [hack] = await db
      .insert(hacksTable)
      .values({
        eventId: event.id,
        teamName,
        projectName,
        projectDescription,
        teamImage: imageId,
      })
      .returning();

    // Associate members (include current user if not provided)
    const uniqueMemberIds = Array.from(new Set([user.id, ...memberIds]));
    if (uniqueMemberIds.length > 0) {
      await db.insert(hackUsersTable).values(
        uniqueMemberIds.map((uid) => ({ hackId: hack.id, userId: uid })),
      );
    }

    return NextResponse.json({ id: hack.id }, { status: 201 });
  } catch (error) {
    console.error("Error registering team:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

