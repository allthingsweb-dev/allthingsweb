import { S3Client } from "bun";
import {
  eventImagesTable,
  eventsTable,
  imagesTable,
} from "@lib/db/schema.server";
import { buildContainer } from "~/modules/container.server";
import { eq } from "drizzle-orm";

export async function getImgIdsForUrls() {
  let container = buildContainer();
  const db = container.cradle.db;
  const images = await db.select().from(imagesTable);
  const ids: string[] = [];
  const imageUrls = [
    "https://allthingsweb-dev.s3.us-west-2.amazonaws.com/events/2025-03-12-all-things-web-hack-evening/3bf9ac48-17e6-4615-9522-feec3d7416de.jpeg",
    "https://allthingsweb-dev.s3.us-west-2.amazonaws.com/events/2025-03-12-all-things-web-hack-evening/72b4d50f-2e05-4c01-aae4-46ee29e229a3.jpeg",
    "https://allthingsweb-dev.s3.us-west-2.amazonaws.com/events/2025-03-12-all-things-web-hack-evening/0780be37-ec65-4b41-acba-0bcb29c65aae.jpeg"
  ];
  for (const image of images) {
    if (imageUrls.includes(image.url)) {
      ids.push(image.id);
    }
  }
  return ids;
}

async function main() {
  let container = buildContainer();
  const ids = await getImgIdsForUrls();

  const bunS3Client = new S3Client({
    region: container.cradle.mainConfig.s3.region,
    accessKeyId: container.cradle.mainConfig.s3.accessKeyId,
    secretAccessKey: container.cradle.mainConfig.s3.secretAccessKey,
    bucket: container.cradle.mainConfig.s3.bucket,
  });

  for await (const id of ids) {
    const image = await container.cradle.db
      .select()
      .from(imagesTable)
      .where(eq(imagesTable.id, id))
      .then((data) => data[0]);
    if (!image) {
      throw Error(`Image with id ${id} not found`);
    }
    const eventImage = await container.cradle.db
      .select()
      .from(eventImagesTable)
      .where(eq(eventImagesTable.imageId, id))
      .then((data) => data[0]);
    if (!eventImage) {
      throw Error(`Event image with id ${id} not found`);
    }
    const event = await container.cradle.db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.id, eventImage.eventId))
      .then((data) => data[0]);
    if (!event) {
      throw Error(`Event with id ${eventImage.eventId} not found`);
    }
    const s3Path = image.url.replace(
      container.cradle.mainConfig.s3.url + "/",
      "",
    );
    await bunS3Client.delete(s3Path);
    await container.cradle.db
      .delete(eventImagesTable)
      .where(eq(eventImagesTable.imageId, id));
    await container.cradle.db.delete(imagesTable).where(eq(imagesTable.id, id));
    console.log(`Deleted image with id ${id} for event ${event.name}`);
  }
}

main();
