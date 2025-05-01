import { S3Client } from "bun";
import { buildContainer } from "~/modules/container.server";
import {
  imagesTable,
  InsertSponsor,
  sponsorsTable,
} from "@lib/db/schema.server";
import { randomUUID } from "node:crypto";
import { getImgMetadata, getImgPlaceholder } from "openimg/bun";

const darkLogoFilePath = "./scripts/logo.png";
const lightLogoFilePath = "./scripts/logo.png";
const sponsor: InsertSponsor = {
    name: "Vapi",
    about: "Vapi is a developer platform for building, testing, and deploying voice AI agents. It provides the infrastructure for businesses and developers to create custom voice assistants that can handle call operations for existing customer support, appointment booking, and sales calls, or for building new products using voice AI like prior authorization and product onboarding assistants. Try Vapi at vapi.ai.",
};

async function main() {
  const container = buildContainer();

  const bunS3Client = new S3Client({
    region: container.cradle.mainConfig.s3.region,
    accessKeyId: container.cradle.mainConfig.s3.accessKeyId,
    secretAccessKey: container.cradle.mainConfig.s3.secretAccessKey,
    bucket: container.cradle.mainConfig.s3.bucket,
  });

  // Process dark logo
  const darkLogoUuid = randomUUID();
  const darkLogoFile = Bun.file(darkLogoFilePath);
  const darkLogoBuffer = await darkLogoFile.bytes();
  const darkLogoMetadata = await getImgMetadata(darkLogoBuffer);
  const nameSlug = sponsor.name.toLowerCase().replace(/ /g, "-");
  const darkLogoS3Path = "sponsors/" + nameSlug + "-dark-" + darkLogoUuid + "." + darkLogoMetadata.format;
  const darkLogoPlaceholder = await getImgPlaceholder(darkLogoBuffer);
  await bunS3Client.write(darkLogoS3Path, darkLogoBuffer);
  const darkLogoUrl = `${container.cradle.mainConfig.s3.url}/${darkLogoS3Path}`;
  await container.cradle.db.insert(imagesTable).values({
    url: darkLogoUrl,
    id: darkLogoUuid,
    width: darkLogoMetadata.width,
    height: darkLogoMetadata.height,
    placeholder: darkLogoPlaceholder,
    alt: `${sponsor.name} dark logo`,
  });

  // Process light logo
  const lightLogoUuid = randomUUID();
  const lightLogoFile = Bun.file(lightLogoFilePath);
  const lightLogoBuffer = await lightLogoFile.bytes();
  const lightLogoMetadata = await getImgMetadata(lightLogoBuffer);
  const lightLogoS3Path = "sponsors/" + nameSlug + "-light-" + lightLogoUuid + "." + lightLogoMetadata.format;
  const lightLogoPlaceholder = await getImgPlaceholder(lightLogoBuffer);
  await bunS3Client.write(lightLogoS3Path, lightLogoBuffer);
  const lightLogoUrl = `${container.cradle.mainConfig.s3.url}/${lightLogoS3Path}`;
  await container.cradle.db.insert(imagesTable).values({
    url: lightLogoUrl,
    id: lightLogoUuid,
    width: lightLogoMetadata.width,
    height: lightLogoMetadata.height,
    placeholder: lightLogoPlaceholder,
    alt: `${sponsor.name} light logo`,
  });

  // Update sponsor object with logo UUIDs
  sponsor.squareLogoDark = darkLogoUuid;
  sponsor.squareLogoLight = lightLogoUuid;

  // Insert sponsor into database
  const sponsorRes = await container.cradle.db
    .insert(sponsorsTable)
    .values(sponsor)
    .returning();
  if (!sponsorRes[0]) {
    console.error("Failed to create sponsor");
    return;
  }

  console.log(sponsorRes[0].id);
}

main();
