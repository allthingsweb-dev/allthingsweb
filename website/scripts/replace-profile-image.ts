import { S3Client } from "bun";
import { buildContainer } from "~/modules/container.server";
import {
  imagesTable,
  InsertProfile,
  profilesTable,
} from "@lib/db/schema.server";
import { randomUUID } from "node:crypto";
import { getImgMetadata, getImgPlaceholder } from "openimg/bun";
import { eq } from "drizzle-orm";

const imgPath = "./scripts/profile.jpeg";
const name = "Sean Strong";

async function main() {
  const container = buildContainer();

  const bunS3Client = new S3Client({
    region: container.cradle.mainConfig.s3.region,
    accessKeyId: container.cradle.mainConfig.s3.accessKeyId,
    secretAccessKey: container.cradle.mainConfig.s3.secretAccessKey,
    bucket: container.cradle.mainConfig.s3.bucket,
  });

  const [profile] = await container.cradle.db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.name, name));
  if (!profile) {
    console.error("Profile not found");
    return;
  }

  const imageToDeleteId = profile.image;
  if (!imageToDeleteId) {
    console.error("No image to delete");
    return;
  }
  const [imageToDelete] = await container.cradle.db
    .select()
    .from(imagesTable)
    .where(eq(imagesTable.id, imageToDeleteId));
  if (!imageToDelete) {
    console.error("Image to delete not found");
    return;
  }

  const uuid = randomUUID();
  const file = Bun.file(imgPath);
  const buffer = await file.bytes();
  const { width, height, format } = await getImgMetadata(buffer);
  const nameSlug = profile.name.toLowerCase().replace(/ /g, "-");
  const path = "profiles/" + nameSlug + "-" + uuid + "." + format;
  const placeholder = await getImgPlaceholder(buffer);
  await bunS3Client.write(path, buffer);
  const url = `${container.cradle.mainConfig.s3.url}/${path}`;
  await container.cradle.db.insert(imagesTable).values({
    url,
    id: uuid,
    width,
    height,
    placeholder,
    alt: `${profile.name} smiling into the camera`,
  });

  await container.cradle.db
    .update(profilesTable)
    .set({
      image: uuid,
    })
    .where(eq(profilesTable.id, profile.id));

  await container.cradle.db
    .delete(imagesTable)
    .where(eq(imagesTable.id, imageToDeleteId));

  await bunS3Client.delete(imageToDelete.url);
}

main();
