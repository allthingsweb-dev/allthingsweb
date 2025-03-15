import { S3Client } from "bun";
import { getImgPlaceholder, getImgMetadata } from "openimg/bun";
import { eventImagesTable, imagesTable } from "@lib/db/schema.server";
import { buildContainer } from "~/modules/container.server";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

async function getFilePaths() {
  const fileNames = await readdir("./scripts/images");
  const filePaths = fileNames.map((fn) => join("./scripts/images", fn));
  return filePaths;
}

async function main() {
  const container = buildContainer();
  const eventSlug = "2025-03-12-all-things-web-hack-evening";
  const event = await container.cradle.queryClient.getEventBySlug(eventSlug);
  if (!event) {
    console.error(`Event with slug ${eventSlug} not found`);
    return;
  }

  const bunS3Client = new S3Client({
    region: container.cradle.mainConfig.s3.region,
    accessKeyId: container.cradle.mainConfig.s3.accessKeyId,
    secretAccessKey: container.cradle.mainConfig.s3.secretAccessKey,
    bucket: container.cradle.mainConfig.s3.bucket,
  });
  const filePaths = await getFilePaths();
  for await (const entry of filePaths) {
    const uuid = randomUUID();
    console.log(entry);
    const file = Bun.file(entry);
    const buffer = await file.bytes();
    const { width, height, format } = await getImgMetadata(buffer);
    const path = "events/" + event.slug + "/" + uuid + "." + format;
    const placeholder = await getImgPlaceholder(buffer);
    await bunS3Client.write(path, buffer);
    const url = `${container.cradle.mainConfig.s3.url}/${path}`;
    const [image] = await container.cradle.db
      .insert(imagesTable)
      .values({
        url,
        id: uuid,
        width,
        height,
        placeholder,
        alt: `Event image for ${event.name}`,
      })
      .returning();
    console.log(image);
    await container.cradle.db.insert(eventImagesTable).values({
      eventId: event.id,
      imageId: image.id,
    });
  }
}

main();
