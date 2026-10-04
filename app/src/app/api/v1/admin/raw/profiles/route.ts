import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { imagesTable, profilesTable } from "@/lib/schema";
import { randomUUID } from "crypto";
import { processImage } from "@/lib/image-processor";
import { eq } from "drizzle-orm";
import { signImage } from "@/lib/image-signing";
import { appMediaStore, removeStoredObject } from "@/lib/media-store";

function slugifyName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function signImageUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  const signed = await signImage({
    url,
    alt: "",
    placeholder: "",
    width: 0,
    height: 0,
  });
  return signed.url;
}

async function deleteImageFromStorage(imageId: string) {
  const existingImage = await db
    .select()
    .from(imagesTable)
    .where(eq(imagesTable.id, imageId))
    .limit(1);
  const image = existingImage[0];
  if (!image) return;

  try {
    await removeStoredObject(image.url);
  } catch (error) {
    console.error("Error deleting profile image from storage:", error);
  }

  await db.delete(imagesTable).where(eq(imagesTable.id, imageId));
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

    const formData = await request.formData();
    const name = (formData.get("name") as string | null)?.trim() ?? "";
    const title = (formData.get("title") as string | null)?.trim() ?? "";
    const bio = (formData.get("bio") as string | null)?.trim() ?? "";
    const profileType =
      (formData.get("profileType") as string | null)?.trim() ?? "";
    const twitterHandle =
      (formData.get("twitterHandle") as string | null)?.trim() ?? null;
    const blueskyHandle =
      (formData.get("blueskyHandle") as string | null)?.trim() ?? null;
    const linkedinHandle =
      (formData.get("linkedinHandle") as string | null)?.trim() ?? null;
    const imageFile = formData.get("image") as File | null;

    if (!name || !title || !bio || !profileType) {
      return NextResponse.json(
        { error: "name, title, bio, and profileType are required" },
        { status: 400 },
      );
    }

    if (profileType !== "member" && profileType !== "organizer") {
      return NextResponse.json(
        { error: "profileType must be one of: member, organizer" },
        { status: 400 },
      );
    }

    let imageId: string | null = null;

    if (imageFile && imageFile.size > 0) {
      const processedImage = await processImage(imageFile, imageFile.name, {
        convertUnsupportedFormats: true,
        conversionFormat: "PNG",
      });

      const uuid = randomUUID();
      const key = `profiles/${slugifyName(name)}-${uuid}.${processedImage.metadata.format}`;

      const url = await appMediaStore().put(
        key,
        processedImage.buffer,
        `image/${processedImage.metadata.format}`,
      );

      await db.insert(imagesTable).values({
        id: uuid,
        url,
        width: processedImage.metadata.width,
        height: processedImage.metadata.height,
        placeholder: processedImage.placeholder,
        alt: `${name} profile image`,
      });

      imageId = uuid;
    }

    const [profile] = await db
      .insert(profilesTable)
      .values({
        name,
        title,
        bio,
        profileType,
        twitterHandle,
        blueskyHandle,
        linkedinHandle,
        image: imageId,
      })
      .returning();

    let imageUrl: string | null = null;
    if (imageId) {
      const image = await db
        .select({ url: imagesTable.url })
        .from(imagesTable)
        .where(eq(imagesTable.id, imageId))
        .limit(1);
      imageUrl = await signImageUrl(image[0]?.url ?? null);
    }

    return NextResponse.json(
      { profile: { ...profile, imageUrl } },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating raw profile:", error);
    return NextResponse.json(
      { error: "Failed to create profile" },
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

    const formData = await request.formData();
    const profileId =
      (formData.get("profileId") as string | null)?.trim() ?? "";
    const name = (formData.get("name") as string | null)?.trim() ?? "";
    const title = (formData.get("title") as string | null)?.trim() ?? "";
    const bio = (formData.get("bio") as string | null)?.trim() ?? "";
    const profileType =
      (formData.get("profileType") as string | null)?.trim() ?? "";
    const twitterHandle =
      (formData.get("twitterHandle") as string | null)?.trim() ?? null;
    const blueskyHandle =
      (formData.get("blueskyHandle") as string | null)?.trim() ?? null;
    const linkedinHandle =
      (formData.get("linkedinHandle") as string | null)?.trim() ?? null;
    const removeImage =
      (formData.get("removeImage") as string | null) === "true";
    const imageFile = formData.get("image") as File | null;

    if (!profileId || !name || !title || !bio || !profileType) {
      return NextResponse.json(
        { error: "profileId, name, title, bio, and profileType are required" },
        { status: 400 },
      );
    }
    if (profileType !== "member" && profileType !== "organizer") {
      return NextResponse.json(
        { error: "profileType must be one of: member, organizer" },
        { status: 400 },
      );
    }

    const existing = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.id, profileId))
      .limit(1);
    const current = existing[0];
    if (!current) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    let nextImageId = current.image;

    if (imageFile && imageFile.size > 0) {
      const processedImage = await processImage(imageFile, imageFile.name, {
        convertUnsupportedFormats: true,
        conversionFormat: "PNG",
      });
      const uuid = randomUUID();
      const key = `profiles/${slugifyName(name)}-${uuid}.${processedImage.metadata.format}`;

      const url = await appMediaStore().put(
        key,
        processedImage.buffer,
        `image/${processedImage.metadata.format}`,
      );

      await db.insert(imagesTable).values({
        id: uuid,
        url,
        width: processedImage.metadata.width,
        height: processedImage.metadata.height,
        placeholder: processedImage.placeholder,
        alt: `${name} profile image`,
      });

      if (current.image) {
        await deleteImageFromStorage(current.image);
      }
      nextImageId = uuid;
    } else if (removeImage && current.image) {
      await deleteImageFromStorage(current.image);
      nextImageId = null;
    }

    const [profile] = await db
      .update(profilesTable)
      .set({
        name,
        title,
        bio,
        profileType,
        twitterHandle,
        blueskyHandle,
        linkedinHandle,
        image: nextImageId,
      })
      .where(eq(profilesTable.id, profileId))
      .returning();

    let imageUrl: string | null = null;
    if (profile.image) {
      const image = await db
        .select({ url: imagesTable.url })
        .from(imagesTable)
        .where(eq(imagesTable.id, profile.image))
        .limit(1);
      imageUrl = await signImageUrl(image[0]?.url ?? null);
    }

    return NextResponse.json({ profile: { ...profile, imageUrl } });
  } catch (error) {
    console.error("Error updating raw profile:", error);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 },
    );
  }
}
