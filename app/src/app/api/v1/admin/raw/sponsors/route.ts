import { NextRequest, NextResponse } from "next/server";
import { stackServerApp } from "@/lib/stack";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { imagesTable, sponsorsTable } from "@/lib/schema";
import { randomUUID } from "crypto";
import { processImage } from "@/lib/image-processor";
import { mainConfig } from "@/lib/config";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { signImage } from "@/lib/image-signing";

const s3Client = new S3Client({
  region: mainConfig.s3.region,
  credentials: {
    accessKeyId: mainConfig.s3.accessKeyId,
    secretAccessKey: mainConfig.s3.secretAccessKey,
  },
});

function slugifyName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function uploadLogo(params: {
  file: File;
  sponsorName: string;
  variant: "dark" | "light";
  uploadedBy: string;
}): Promise<string> {
  const { file, sponsorName, variant, uploadedBy } = params;

  const processedImage = await processImage(file, file.name, {
    convertUnsupportedFormats: true,
    conversionFormat: "PNG",
  });

  const uuid = randomUUID();
  const key = `sponsors/${slugifyName(sponsorName)}-${variant}-${uuid}.${processedImage.metadata.format}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: mainConfig.s3.bucket,
      Key: key,
      Body: processedImage.buffer,
      ContentType: `image/${processedImage.metadata.format}`,
      Metadata: {
        originalName: file.name,
        originalFormat: processedImage.originalFormat,
        wasConverted: processedImage.wasConverted.toString(),
        uploadedBy,
      },
    }),
  );

  await db.insert(imagesTable).values({
    id: uuid,
    url: `${mainConfig.s3.url}/${key}`,
    width: processedImage.metadata.width,
    height: processedImage.metadata.height,
    placeholder: processedImage.placeholder,
    alt: `${sponsorName} ${variant} logo`,
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

  const s3Path = image.url.replace(mainConfig.s3.url + "/", "");
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: mainConfig.s3.bucket,
        Key: s3Path,
      }),
    );
  } catch (error) {
    console.error("Error deleting sponsor image from S3:", error);
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
      sponsorName: name,
      variant: "dark",
      uploadedBy: user.id,
    });

    const squareLogoLight = await uploadLogo({
      file: lightLogo,
      sponsorName: name,
      variant: "light",
      uploadedBy: user.id,
    });

    const [sponsor] = await db
      .insert(sponsorsTable)
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
      .where(eq(imagesTable.id, sponsor.squareLogoDark!))
      .limit(1);
    const lightImage = await db
      .select({ url: imagesTable.url })
      .from(imagesTable)
      .where(eq(imagesTable.id, sponsor.squareLogoLight!))
      .limit(1);

    return NextResponse.json(
      {
        sponsor: {
          ...sponsor,
          squareLogoDarkUrl: await signImageUrl(darkImage[0]?.url ?? null),
          squareLogoLightUrl: await signImageUrl(lightImage[0]?.url ?? null),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating raw sponsor:", error);
    return NextResponse.json(
      { error: "Failed to create sponsor" },
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
    const sponsorId =
      (formData.get("sponsorId") as string | null)?.trim() ?? "";
    const name = (formData.get("name") as string | null)?.trim() ?? "";
    const about = (formData.get("about") as string | null)?.trim() ?? "";
    const darkLogo = formData.get("darkLogo") as File | null;
    const lightLogo = formData.get("lightLogo") as File | null;

    if (!sponsorId || !name || !about) {
      return NextResponse.json(
        { error: "sponsorId, name, and about are required" },
        { status: 400 },
      );
    }

    const existing = await db
      .select()
      .from(sponsorsTable)
      .where(eq(sponsorsTable.id, sponsorId))
      .limit(1);
    const current = existing[0];
    if (!current) {
      return NextResponse.json({ error: "Sponsor not found" }, { status: 404 });
    }

    let squareLogoDark = current.squareLogoDark;
    let squareLogoLight = current.squareLogoLight;
    const oldDark = current.squareLogoDark;
    const oldLight = current.squareLogoLight;

    if (darkLogo && darkLogo.size > 0) {
      squareLogoDark = await uploadLogo({
        file: darkLogo,
        sponsorName: name,
        variant: "dark",
        uploadedBy: user.id,
      });
    }

    if (lightLogo && lightLogo.size > 0) {
      squareLogoLight = await uploadLogo({
        file: lightLogo,
        sponsorName: name,
        variant: "light",
        uploadedBy: user.id,
      });
    }

    const [sponsor] = await db
      .update(sponsorsTable)
      .set({
        name,
        about,
        squareLogoDark,
        squareLogoLight,
      })
      .where(eq(sponsorsTable.id, sponsorId))
      .returning();

    if (oldDark && oldDark !== squareLogoDark) {
      await deleteImageFromStorage(oldDark);
    }
    if (oldLight && oldLight !== squareLogoLight) {
      await deleteImageFromStorage(oldLight);
    }

    const darkImage = sponsor.squareLogoDark
      ? await db
          .select({ url: imagesTable.url })
          .from(imagesTable)
          .where(eq(imagesTable.id, sponsor.squareLogoDark))
          .limit(1)
      : [];
    const lightImage = sponsor.squareLogoLight
      ? await db
          .select({ url: imagesTable.url })
          .from(imagesTable)
          .where(eq(imagesTable.id, sponsor.squareLogoLight))
          .limit(1)
      : [];

    return NextResponse.json({
      sponsor: {
        ...sponsor,
        squareLogoDarkUrl: await signImageUrl(darkImage[0]?.url ?? null),
        squareLogoLightUrl: await signImageUrl(lightImage[0]?.url ?? null),
      },
    });
  } catch (error) {
    console.error("Error updating raw sponsor:", error);
    return NextResponse.json(
      { error: "Failed to update sponsor" },
      { status: 500 },
    );
  }
}
