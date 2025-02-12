import { S3Client } from "bun";
import { getPixels, getFormat } from "@unpic/pixels";
import { Readable } from "node:stream";
import { getImgPlaceholderFromStream } from "openimg/bun";
import { eventImagesTable, imagesTable } from "../app/modules/db/schema.server";
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
  const eventSlug = "2025-01-28-all-things-web-at-sanity";
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
    const { width, height } = await getPixels(buffer);
    const format = await getFormat(buffer);
    const path = "events/" + event.slug + "/" + uuid + "." + format;
    const nodeStream = Readable.fromWeb(file.stream() as any);
    const placeholder = await getImgPlaceholderFromStream(nodeStream);
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

  // for (const image of images) {
  //   if(image.placeholder) {
  //     // console.log(`Image ${image.id} already has a placeholder`);
  //     continue;
  //   }
  //   console.log(`Generating placeholder for image ${image.id}`);
  //   const signedUrl = await s3.presign(image.url);
  //   const res = await fetch(signedUrl);
  //   if(!res.ok) {
  //     console.error(`Failed to fetch image ${image.id}: ${res.status} ${res.statusText} with URL ${signedUrl}`);
  //     const x = await db.select().from(eventImagesTable).where(eq(eventImagesTable.imageId, image.id));
  //     if(x.length > 1) {
  //       console.error(`Image ${image.id} is used in several events, skipping`);
  //       continue;
  //     }
  //     if(x.length === 0) {
  //       console.error(`Image ${image.id} is not used in any event, deleting`);
  //       await db.delete(imagesTable).where(eq(imagesTable.id, image.id));
  //       continue;
  //     }
  //     const evt = x[0].eventId;
  //     console.log('Event ID:', evt);
  //     continue;
  //   }
  //   const { width, height } = await getPixels(signedUrl);
  //   const nodeStream = Readable.fromWeb(res.body as any);
  //   const placeholder = await getImgPlaceholderFromStream(nodeStream);
  //   await db.update(imagesTable).set({ width, height, placeholder }).where(eq(imagesTable.id, image.id));
  //   console.log(`Updated image ${image.id} with width ${width}, height ${height}`);
  // }
}

main();
