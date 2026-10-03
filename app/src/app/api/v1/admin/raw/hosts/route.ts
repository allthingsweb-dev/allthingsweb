import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { imagesTable, hostsTable } from "@/lib/schema";
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

async function uploadLogo(params: {
  file: File;
  hostName: string;
  variant: "dark" | "light";
}): Promise<string> {
  const { file, hostName, variant } = params;

  const processedImage = await processImage(file, file.name, {
    convertUnsupportedFormats: true,
    conversionFormat: "PNG",
  });

  const uuid = randomUUID();
  const key = `sponsors/${slugifyName(hostName)}-${variant}-${uuid}.${processedImage.metadata.format}`;

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
    alt: `${hostName} ${variant} logo`,
  });

  return uuid;
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
    console.error("Error deleting host image from storage:", error);
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
    const about = (formData.get("about") as string | null)?.trim() ?? "";
    const darkLogo = formData.get("darkLogo") as File | null;
    const lightLogo = formData.get("lightLogo") as File | null;

    if (!name || !about) {
      return NextResponse.json(
        { error: "name and about are required" },
        { status: 400 },
      );
    }

    if (
      !darkLogo ||
      !lightLogo ||
      darkLogo.size === 0 ||
      lightLogo.size === 0
    ) {
      return NextResponse.json(
        { error: "Both darkLogo and lightLogo image files are required" },
        { status: 400 },
      );
    }

    const squareLogoDark = await uploadLogo({
      file: darkLogo,
      hostName: name,
      variant: "dark",
    });

    const squareLogoLight = await uploadLogo({
      file: lightLogo,
      hostName: name,
      variant: "light",
    });

    const [host] = await db
      .insert(hostsTable)
      .values({
        name,
        about,
        squareLogoDark,
        squareLogoLight,
      })
      .returning();

    const darkImage = await db
      .select({ url: imagesTable.url })
      .from(imagesTable)
      .where(eq(imagesTable.id, host.squareLogoDark!))
      .limit(1);
    const lightImage = await db
      .select({ url: imagesTable.url })
      .from(imagesTable)
      .where(eq(imagesTable.id, host.squareLogoLight!))
      .limit(1);

    return NextResponse.json(
      {
        host: {
          ...host,
          squareLogoDarkUrl: await signImageUrl(darkImage[0]?.url ?? null),
          squareLogoLightUrl: await signImageUrl(lightImage[0]?.url ?? null),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating raw host:", error);
    return NextResponse.json(
      { error: "Failed to create host" },
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
    const hostId = (formData.get("hostId") as string | null)?.trim() ?? "";
    const name = (formData.get("name") as string | null)?.trim() ?? "";
    const about = (formData.get("about") as string | null)?.trim() ?? "";
    const darkLogo = formData.get("darkLogo") as File | null;
    const lightLogo = formData.get("lightLogo") as File | null;

    if (!hostId || !name || !about) {
      return NextResponse.json(
        { error: "hostId, name, and about are required" },
        { status: 400 },
      );
    }

    const existing = await db
      .select()
      .from(hostsTable)
      .where(eq(hostsTable.id, hostId))
      .limit(1);
    const current = existing[0];
    if (!current) {
      return NextResponse.json({ error: "Host not found" }, { status: 404 });
    }

    let squareLogoDark = current.squareLogoDark;
    let squareLogoLight = current.squareLogoLight;
    const oldDark = current.squareLogoDark;
    const oldLight = current.squareLogoLight;

    if (darkLogo && darkLogo.size > 0) {
      squareLogoDark = await uploadLogo({
        file: darkLogo,
        hostName: name,
        variant: "dark",
      });
    }

    if (lightLogo && lightLogo.size > 0) {
      squareLogoLight = await uploadLogo({
        file: lightLogo,
        hostName: name,
        variant: "light",
      });
    }

    const [host] = await db
      .update(hostsTable)
      .set({
        name,
        about,
        squareLogoDark,
        squareLogoLight,
      })
      .where(eq(hostsTable.id, hostId))
      .returning();

    if (oldDark && oldDark !== squareLogoDark) {
      await deleteImageFromStorage(oldDark);
    }
    if (oldLight && oldLight !== squareLogoLight) {
      await deleteImageFromStorage(oldLight);
    }

    const darkImage = host.squareLogoDark
      ? await db
          .select({ url: imagesTable.url })
          .from(imagesTable)
          .where(eq(imagesTable.id, host.squareLogoDark))
          .limit(1)
      : [];
    const lightImage = host.squareLogoLight
      ? await db
          .select({ url: imagesTable.url })
          .from(imagesTable)
          .where(eq(imagesTable.id, host.squareLogoLight))
          .limit(1)
      : [];

    return NextResponse.json({
      host: {
        ...host,
        squareLogoDarkUrl: await signImageUrl(darkImage[0]?.url ?? null),
        squareLogoLightUrl: await signImageUrl(lightImage[0]?.url ?? null),
      },
    });
  } catch (error) {
    console.error("Error updating raw host:", error);
    return NextResponse.json(
      { error: "Failed to update host" },
      { status: 500 },
    );
  }
}
