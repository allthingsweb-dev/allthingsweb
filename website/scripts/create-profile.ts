import { S3Client } from "bun";
import { buildContainer } from "~/modules/container.server";
import {
  imagesTable,
  InsertProfile,
  profilesTable,
} from "~/modules/db/schema.server";
import { randomUUID } from "node:crypto";
import { getImgMetadata, getImgPlaceholder } from "openimg/bun";

const imgPath = "./scripts/profile.png";
const profile: InsertProfile = {
  name: "Cody De Arkland",
  title: "Developer Experience @ Sentry",
  bio: "Cody is a Senior Director at Sentry for Developer Experience. He is a passionate technologist who loves learning, community, and sharing knowledge.",
  linkedinHandle: "codydearkland",
  twitterHandle: "Codydearkland",
  profileType: "member",
};

async function main() {
  const container = buildContainer();

  const bunS3Client = new S3Client({
    region: container.cradle.mainConfig.s3.region,
    accessKeyId: container.cradle.mainConfig.s3.accessKeyId,
    secretAccessKey: container.cradle.mainConfig.s3.secretAccessKey,
    bucket: container.cradle.mainConfig.s3.bucket,
  });

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

  profile.image = uuid;
  const profileRes = await container.cradle.db
    .insert(profilesTable)
    .values(profile)
    .returning();
  if (!profileRes[0]) {
    console.error("Failed to create profile");
    return;
  }

  console.log(profileRes[0].id);
}

main();
